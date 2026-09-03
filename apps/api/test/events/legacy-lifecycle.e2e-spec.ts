import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { EventLifecycleState } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 014 EARS-23…27 (#1741) — the PRE-PLATFORM (legacy) broadcast lifecycle: the
// second state machine, selected by `events.origin`, that an эфир held before
// features 006/007 existed runs on (014-design §3.1).
//
// What these rows pin, beyond «the state changes»:
//
//  1. EARS-23 — `origin` is a server-assigned DISCRIMINATOR, set once at
//     creation and refused by every update path, so no event ever crosses
//     between the two machines;
//  2. EARS-24 — `CreateLegacyBroadcast` files the эфир and the recording it
//     exists to carry in ONE transaction, born `hidden`, with no room, no stream
//     config and no presence window — states the legacy machine cannot reach;
//  3. EARS-25 — «Архивировать» is gated on a PUBLISHED recording (409
//     `EVENT_NOT_FINISHED` otherwise, nothing written) and «Скрыть» takes it
//     back out, each with its own audit id;
//  4. EARS-26 — an archived эфир projects onto the doctor storefront as the SAME
//     `recorded` card a platform `ended` broadcast does, and a hidden one is
//     absent from the feed entirely;
//  5. EARS-27 — MUTUAL EXCLUSION in both directions: a broadcast command on a
//     `legacy` event and a legacy command on a `platform` event are each refused
//     409 `INVALID_TRANSITION` with the state untouched.
//
// Runs against dev-stand Postgres + the fake IdP session; skips when absent so
// the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-23…27 legacy broadcast lifecycle (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Register + grant `platform_admin` + establish the ADMIN session (011 EARS-2). */
    async function adminSession(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]).toBeDefined();
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
    }

    /** Build a multipart/form-data body from string fields (the 007 write surface). */
    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds1741${Math.random().toString(16).slice(2)}`;
      const chunks: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    /**
     * A МСК wall-clock stamp `offsetDays` from now — derived, never a pinned
     * literal: these rows are ABOUT a broadcast that already happened, and a
     * hardcoded year silently turns a past fixture into a future one.
     */
    function mskStamp(offsetDays: number): string {
      return new Date(
        Date.now() + offsetDays * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 16);
    }

    /** The `YYYY-MM-DD` МСК day an `mskStamp` falls on (the feed's grouping key). */
    function mskDay(stamp: string): string {
      return stamp.slice(0, 10);
    }

    /** The day after `YYYY-MM-DD`, for the feed's half-open horizon. */
    function nextDay(day: string): string {
      return new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }

    interface AdminDetail {
      id: string;
      state: EventLifecycleState;
      origin: "platform" | "legacy";
      version: number;
      validTransitions: EventLifecycleState[];
    }

    /** `POST /v1/admin/legacy-broadcasts` — the EARS-24 create entry. */
    async function createLegacy(
      cookie: string,
      overrides: Record<string, unknown> = {},
    ) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/legacy-broadcasts",
        headers: {
          ...device,
          ...authHeaders(cookie),
          "content-type": "application/json",
        },
        payload: {
          title: `Архивный эфир ${randomUUID().slice(0, 8)}`,
          heldAtMsk: mskStamp(-10),
          durationMin: 90,
          specialties: ["cardiology"],
          speakers: [{ name: "И. И. Иванов", regalia: "д.м.н." }],
          recording: {
            kind: "full",
            provider: "youtube",
            embedRef: "dQw4w9WgXcQ",
          },
          ...overrides,
        },
      });
    }

    /** Create a legacy эфир and register it for cleanup; returns its admin detail. */
    async function legacyBroadcast(
      cookie: string,
      overrides: Record<string, unknown> = {},
    ): Promise<AdminDetail> {
      const res = await createLegacy(cookie, overrides);
      expect(res.statusCode).toBe(201);
      const detail = res.json() as AdminDetail;
      createdEventIds.push(detail.id);
      return detail;
    }

    /** Create a fresh PLATFORM draft through the 007 EARS-1 create endpoint. */
    async function createPlatformDraft(cookie: string): Promise<string> {
      const mp = multipartBody({
        payload: JSON.stringify({
          title: `Платформенный эфир ${randomUUID().slice(0, 8)}`,
          school: "Кардиология",
          startsAtMsk: mskStamp(-10),
          durationMin: 90,
          specialties: ["cardiology"],
        }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...authHeaders(cookie),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      createdEventIds.push(id);
      return id;
    }

    /** The current event `If-Match` validator (#1593) — every command is conditional. */
    async function ifMatch(id: string): Promise<Record<string, string>> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM events WHERE id = $1",
        [id],
      );
      return { "if-match": `"${rows[0]?.version ?? 1}"` };
    }

    /** POST one named event command (`archive-legacy`, `publish`, …). */
    async function eventCommand(cookie: string, id: string, command: string) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/${command}`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          ...(await ifMatch(id)),
          "idempotency-key": randomUUID(),
        },
      });
    }

    /** The single recording row the create transaction filed for this эфир. */
    async function recordingRow(
      eventId: string,
    ): Promise<{ id: string; status: string; version: number }> {
      const { rows } = await pool.query<{
        id: string;
        status: string;
        version: number;
      }>(
        "SELECT id, status, version FROM event_recordings WHERE event_id = $1",
        [eventId],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    /** Publish the эфир's recording through 014's OWN recordings command. */
    async function publishRecording(
      cookie: string,
      eventId: string,
    ): Promise<void> {
      const row = await recordingRow(eventId);
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${eventId}/recordings/${row.id}/publish`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          "if-match": `W/"${row.version}"`,
          "idempotency-key": randomUUID(),
        },
      });
      expect(res.statusCode).toBe(200);
    }

    async function adminDetail(
      cookie: string,
      id: string,
    ): Promise<AdminDetail> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${id}`,
        headers: { ...device, ...authHeaders(cookie) },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as AdminDetail;
    }

    async function persisted(
      id: string,
    ): Promise<{ state: string; origin: string } | undefined> {
      const { rows } = await pool.query<{ state: string; origin: string }>(
        "SELECT state, origin FROM events WHERE id = $1",
        [id],
      );
      return rows[0];
    }

    async function childCount(table: string, id: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE event_id = $1`,
        [id],
      );
      return Number(rows[0]?.count ?? "0");
    }

    async function auditCount(id: string, eventType: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_ledger
           WHERE event_type = $1 AND metadata->>'aggregateId' = $2`,
        [eventType, id],
      );
      return Number(rows[0]?.count ?? "0");
    }

    /** The doctor storefront day feed over the эфир's own day (EARS-26). */
    async function feedCardFor(
      id: string,
      heldAtMsk: string,
    ): Promise<{ id: string; state: string } | undefined> {
      const day = mskDay(heldAtMsk);
      const res = await app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events?from=${day}&to=${nextDay(day)}`,
      });
      expect(res.statusCode).toBe(200);
      const feed = res.json() as {
        days: { items: { id: string; state: string }[] }[];
      };
      return feed.days
        .flatMap((group) => group.items)
        .find((item) => item.id === id);
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0))
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("014 EARS-23: `origin` is a server-assigned discriminator — a legacy эфир runs machine 2, a platform event machine 1, and no update moves either between them", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));

      const legacy = await legacyBroadcast(cookie);
      expect(legacy.origin).toBe("legacy");
      const platformId = await createPlatformDraft(cookie);
      expect((await adminDetail(cookie, platformId)).origin).toBe("platform");

      // The body may not author it: the create schema is `.strict()`, so a
      // hopeful `origin` is a 400 at the I/O boundary, not a silently ignored key.
      const authored = await createLegacy(cookie, { origin: "platform" });
      expect(authored.statusCode).toBe(400);

      // Nor may an edit: the discriminator picks the machine, so a mutable one
      // would let an эфир hold a state its own machine cannot reach.
      const mp = multipartBody({
        payload: JSON.stringify({ origin: "platform" }),
      });
      const patched = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${legacy.id}`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          ...(await ifMatch(legacy.id)),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(patched.statusCode).toBe(400);
      expect((await persisted(legacy.id))?.origin).toBe("legacy");
    });

    it("014 EARS-24: CreateLegacyBroadcast files the эфир and its recording in one transaction, born hidden, with no room, stream config or presence window", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const res = await createLegacy(cookie);
      expect(res.statusCode).toBe(201);
      const detail = res.json() as AdminDetail;
      createdEventIds.push(detail.id);

      // The 201 carries the aggregate AND its validator, so a create-then-archive
      // operator never has to re-read the detail just to obtain an `If-Match`.
      expect(res.headers.etag).toBeDefined();
      expect(detail.state).toBe("hidden");
      expect(detail.origin).toBe("legacy");
      expect(await persisted(detail.id)).toEqual({
        state: "hidden",
        origin: "legacy",
      });

      // The эфир exists to carry a recording: the create files exactly one, in
      // `draft`. Publishing it is the separate act «Архивировать» is gated on.
      const recording = await recordingRow(detail.id);
      expect(recording.status).toBe("draft");

      // No room, no stream, no presence — not because the create omits them, but
      // because nothing on the legacy machine can ever reach `live`.
      expect(await childCount("stream_config", detail.id)).toBe(0);
      expect(await childCount("presence_beats", detail.id)).toBe(0);
      const { rows } = await pool.query<{ live_at: Date | null }>(
        "SELECT live_at FROM events WHERE id = $1",
        [detail.id],
      );
      expect(rows[0]?.live_at ?? null).toBeNull();
    });

    it("014 EARS-25.1: with a published recording, ArchiveLegacyBroadcast moves hidden→in_archive and writes its own audit id", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const legacy = await legacyBroadcast(cookie);

      // «Архивировать» is not offered while the recording is still `draft` — the
      // read model carries the precondition, so the control appears exactly when
      // the command would succeed (014-design §3.1).
      expect((await adminDetail(cookie, legacy.id)).validTransitions).toEqual(
        [],
      );
      await publishRecording(cookie, legacy.id);
      expect((await adminDetail(cookie, legacy.id)).validTransitions).toEqual([
        "in_archive",
      ]);

      const res = await eventCommand(cookie, legacy.id, "archive-legacy");
      expect(res.statusCode).toBe(200);
      expect((res.json() as AdminDetail).state).toBe("in_archive");
      expect((await persisted(legacy.id))?.state).toBe("in_archive");
      expect(await auditCount(legacy.id, "event.archived_legacy")).toBe(1);
      // Never 007's terminal ids: the ledger must still answer «did we host it?».
      expect(await auditCount(legacy.id, "event.ended")).toBe(0);
    });

    it("014 EARS-25.2: without a published recording the archive is refused 409 EVENT_NOT_FINISHED, the state untouched and nothing written", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const legacy = await legacyBroadcast(cookie);

      const res = await eventCommand(cookie, legacy.id, "archive-legacy");
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code?: string }).code).toBe("EVENT_NOT_FINISHED");
      expect((await persisted(legacy.id))?.state).toBe("hidden");
      expect(await auditCount(legacy.id, "event.archived_legacy")).toBe(0);
    });

    it("014 EARS-25.3: HideLegacyBroadcast takes an archived эфир back out, reversibly, under its own audit id", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const legacy = await legacyBroadcast(cookie);
      await publishRecording(cookie, legacy.id);
      expect(
        (await eventCommand(cookie, legacy.id, "archive-legacy")).statusCode,
      ).toBe(200);

      const hidden = await eventCommand(cookie, legacy.id, "hide-legacy");
      expect(hidden.statusCode).toBe(200);
      expect((hidden.json() as AdminDetail).state).toBe("hidden");
      expect(await auditCount(legacy.id, "event.hidden_legacy")).toBe(1);
      // A terminal `HideEvent` id would make a reversible hide unreadable in the
      // ledger — the two commands keep separate ids for exactly this.
      expect(await auditCount(legacy.id, "event.hidden")).toBe(0);

      // Reversible: the эфир can be archived again from `hidden`.
      expect((await adminDetail(cookie, legacy.id)).validTransitions).toEqual([
        "in_archive",
      ]);
      expect(
        (await eventCommand(cookie, legacy.id, "archive-legacy")).statusCode,
      ).toBe(200);
      expect((await persisted(legacy.id))?.state).toBe("in_archive");
    });

    it("014 EARS-26: an archived эфир is the SAME `recorded` card as a platform ended broadcast, and a hidden one is absent from the feed", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const heldAtMsk = mskStamp(-10);
      const legacy = await legacyBroadcast(cookie, { heldAtMsk });

      // Born `hidden`: on no public surface at all until an explicit archive.
      expect(await feedCardFor(legacy.id, heldAtMsk)).toBeUndefined();

      await publishRecording(cookie, legacy.id);
      expect(
        (await eventCommand(cookie, legacy.id, "archive-legacy")).statusCode,
      ).toBe(200);

      const card = await feedCardFor(legacy.id, heldAtMsk);
      // The same tab, the same card, the same count — a separate card state
      // would be the second surface 014-design §3.1 forbids.
      expect(card?.state).toBe("recorded");

      expect(
        (await eventCommand(cookie, legacy.id, "hide-legacy")).statusCode,
      ).toBe(200);
      expect(await feedCardFor(legacy.id, heldAtMsk)).toBeUndefined();
    });

    it("014 EARS-27.1: every broadcast command on a legacy эфир is refused 409 INVALID_TRANSITION with the state untouched", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const legacy = await legacyBroadcast(cookie);

      for (const command of ["publish", "open", "close", "hide"]) {
        const res = await eventCommand(cookie, legacy.id, command);
        expect(res.statusCode, `${command} on a legacy эфир must be refused`)
          .toBe(409);
        expect((res.json() as { code?: string }).code).toBe(
          "INVALID_TRANSITION",
        );
        expect((await persisted(legacy.id))?.state).toBe("hidden");
      }
    });

    it("014 EARS-27.2: every legacy command on a platform event is refused 409 INVALID_TRANSITION with the state untouched", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const platformId = await createPlatformDraft(cookie);

      for (const command of ["archive-legacy", "hide-legacy"]) {
        const res = await eventCommand(cookie, platformId, command);
        expect(res.statusCode, `${command} on a platform event must be refused`)
          .toBe(409);
        expect((res.json() as { code?: string }).code).toBe(
          "INVALID_TRANSITION",
        );
        expect((await persisted(platformId))?.state).toBe("draft");
      }

      // `hide-legacy` targets `hidden`, and `ended → hidden` IS legal on the
      // platform machine — so the closed set alone would let the legacy command
      // through on a platform event and stamp the reversible-hide audit id on a
      // TERMINAL hide. The origin guard is what closes that one hole.
      await pool.query("UPDATE events SET state = 'ended' WHERE id = $1", [
        platformId,
      ]);
      const onEnded = await eventCommand(cookie, platformId, "hide-legacy");
      expect(onEnded.statusCode).toBe(409);
      expect((await persisted(platformId))?.state).toBe("ended");
      expect(await auditCount(platformId, "event.hidden_legacy")).toBe(0);
    });
  },
);
