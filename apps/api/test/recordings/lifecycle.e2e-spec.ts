import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 014 EARS-1 / EARS-2 / EARS-17 (#1339) — retained event recordings over the REAL
// stack: Fastify + the 011 admin session + Postgres.
//
// Two things this suite is deliberately strict about, because they are what the
// spec is actually promising (014-design §2, §3):
//
// 1. Every refusal is asserted to have changed NOTHING — the row count, the
//    recording's own version and the EVENT's lifecycle state are all re-read
//    afterwards. "Refused" and "refused without a side effect" are different
//    guarantees and only the second one is 014.
// 2. Nothing is ever deleted. `retire` frees the `(event_id, kind)` slot while
//    the row stays addressable, and the suite proves the absence of a delete
//    path at the router as well as in the data.
//
// The event fixtures are inserted directly: 007 owns the event's own transitions
// and its multipart create, and re-driving them here would make an unrelated 007
// failure fail a suite about recordings. What 014 reads off the event is exactly
// one column — `state` — so the fixture sets it.

const RUTUBE_REF = "0123456789abcdef0123456789abcdef";
const RUTUBE_REF_2 = "fedcba9876543210fedcba9876543210";
const YOUTUBE_REF = "dQw4w9WgXcQ";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-1/EARS-2 retained event recordings (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function key(): string {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    }

    async function adminSession(): Promise<string> {
      const email = uniqueEmail("rec-admin");
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
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
    }

    /** A doctor-portal (non-admin) session cookie — the 401 probe. */
    async function doctorCookie(): Promise<string> {
      const email = uniqueEmail("rec-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    }

    /** One event in the given lifecycle state; tracked for cleanup. */
    async function insertEvent(state = "ended"): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state)
         VALUES ($1, $2, $3, now() - interval '2 days', 90, $4)
         RETURNING id`,
        [
          `rec-1339-${randomUUID()}`,
          "Мероприятие 1339",
          "Кардиология сегодня",
          state,
        ],
      );
      const id = rows[0]!.id;
      createdEventIds.push(id);
      return id;
    }

    interface RecordingBody {
      id: string;
      kind: string;
      status: string;
      version: number;
      provider: string;
      embedRef: string;
      posterRef: string | null;
      durationSec: number | null;
      firstPublishedAt: string | null;
      deletedAt: string | null;
      validCommands: string[];
    }

    function attachPayload(overrides: Record<string, unknown> = {}) {
      return {
        kind: "edited",
        provider: "rutube",
        embedRef: RUTUBE_REF,
        ...overrides,
      };
    }

    async function attach(
      eventId: string,
      payload: Record<string, unknown> = attachPayload(),
      opts: { sid?: string; idempotencyKey?: string; cookie?: string } = {},
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${eventId}/recordings`,
        headers: {
          ...device,
          ...(opts.cookie === undefined
            ? adminHeaders(opts.sid ?? adminSid)
            : { cookie: `${SESSION_COOKIE_NAME}=${opts.cookie}` }),
          "content-type": "application/json",
          ...(opts.idempotencyKey === undefined
            ? { "idempotency-key": key() }
            : opts.idempotencyKey === ""
              ? {}
              : { "idempotency-key": opts.idempotencyKey }),
        },
        payload,
      });
    }

    /** Attach and return the created row, asserting the 201. */
    async function attached(
      eventId: string,
      payload: Record<string, unknown> = attachPayload(),
    ): Promise<RecordingBody> {
      const res = await attach(eventId, payload);
      expect(res.statusCode).toBe(201);
      return JSON.parse(res.payload) as RecordingBody;
    }

    async function command(
      eventId: string,
      recordingId: string,
      cmd: string,
      opts: {
        version?: number | string;
        idempotencyKey?: string;
        sid?: string;
      } = {},
    ) {
      const ifMatch =
        opts.version === undefined
          ? undefined
          : typeof opts.version === "number"
            ? `W/"${opts.version}"`
            : opts.version;
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${eventId}/recordings/${recordingId}/${cmd}`,
        headers: {
          ...device,
          ...adminHeaders(opts.sid ?? adminSid),
          ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
          ...(opts.idempotencyKey === ""
            ? {}
            : { "idempotency-key": opts.idempotencyKey ?? key() }),
        },
      });
    }

    /** Run a command and assert it succeeded; returns the moved row. */
    async function commanded(
      eventId: string,
      recordingId: string,
      cmd: string,
      version: number,
    ): Promise<RecordingBody> {
      const res = await command(eventId, recordingId, cmd, { version });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload) as RecordingBody;
    }

    async function list(eventId: string, sid?: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/events/${eventId}/recordings`,
        headers: { ...device, ...adminHeaders(sid ?? adminSid) },
      });
    }

    function problem(res: { payload: string }): {
      errorCode: string;
      detail?: string;
      traceId: string;
    } {
      return JSON.parse(res.payload) as {
        errorCode: string;
        detail?: string;
        traceId: string;
      };
    }

    async function rowCount(eventId: string): Promise<number> {
      const { rows } = await pool.query(
        "SELECT count(*) FROM event_recordings WHERE event_id = $1",
        [eventId],
      );
      return Number(rows[0]!.count);
    }

    async function eventState(eventId: string): Promise<string> {
      const { rows } = await pool.query<{ state: string }>(
        "SELECT state FROM events WHERE id = $1",
        [eventId],
      );
      return rows[0]!.state;
    }

    async function dbRow(id: string) {
      const { rows } = await pool.query<{
        status: string;
        version: number;
        deleted_at: Date | null;
        first_published_at: Date | null;
        embed_ref: string;
      }>(
        `SELECT status, version, deleted_at, first_published_at, embed_ref
           FROM event_recordings WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
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
      await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await adminSession();
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    // ── EARS-1 — attach ────────────────────────────────────────────────────

    it("014 EARS-1: when a platform_admin attaches a recording, the system shall persist one draft row with a stable id, version 1, its source and an ETag", async () => {
      const eventId = await insertEvent("ended");
      const res = await attach(
        eventId,
        attachPayload({ posterRef: "posters/1339.webp", durationSec: 5400 }),
      );
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload) as RecordingBody;
      expect(body).toMatchObject({
        eventId,
        kind: "edited",
        provider: "rutube",
        embedRef: RUTUBE_REF,
        posterRef: "posters/1339.webp",
        durationSec: 5400,
        // Attachment and publication are two acts: a fresh row is never visible.
        status: "draft",
        version: 1,
        firstPublishedAt: null,
        deletedAt: null,
      });
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(
        `/v1/admin/events/${eventId}/recordings/${body.id}`,
      );
      // The event itself was NOT touched by attaching a recording.
      expect(await eventState(eventId)).toBe("ended");

      const listed = await list(eventId);
      expect(listed.statusCode).toBe(200);
      const listBody = JSON.parse(listed.payload) as {
        data: RecordingBody[];
        total: number;
        eventState: string;
      };
      expect(listBody.total).toBe(1);
      expect(listBody.data[0]!.id).toBe(body.id);
      expect(listBody.eventState).toBe("ended");
    });

    it("014 EARS-1: when a second recording of a non-retired kind is attached, the system shall refuse with 409 RECORDING_KIND_OCCUPIED naming the holder and persist no second row", async () => {
      const eventId = await insertEvent("ended");
      const first = await attached(eventId);
      const res = await attach(
        eventId,
        attachPayload({ embedRef: RUTUBE_REF_2 }),
      );
      expect(res.statusCode).toBe(409);
      const body = problem(res);
      expect(body.errorCode).toBe("RECORDING_KIND_OCCUPIED");
      // NAMING the row is the point: the operator has to be able to act on it.
      expect(body.detail).toContain(first.id);
      expect(await rowCount(eventId)).toBe(1);
      expect((await dbRow(first.id))!.embed_ref).toBe(RUTUBE_REF);
    });

    it("014 EARS-1: the other kind is a separate slot — an occupied edited slot shall not block a raw attach", async () => {
      const eventId = await insertEvent("ended");
      await attached(eventId);
      const raw = await attached(
        eventId,
        attachPayload({
          kind: "raw",
          provider: "youtube",
          embedRef: YOUTUBE_REF,
        }),
      );
      expect(raw.kind).toBe("raw");
      expect(await rowCount(eventId)).toBe(2);
    });

    it("014 EARS-1: when a recording is corrected with a matching If-Match, the system shall update the same row and bump its version", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${eventId}/recordings/${row.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "if-match": 'W/"1"',
          "idempotency-key": key(),
        },
        payload: {
          provider: "youtube",
          embedRef: YOUTUBE_REF,
          durationSec: 3600,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as RecordingBody;
      expect(body).toMatchObject({
        id: row.id,
        provider: "youtube",
        embedRef: YOUTUBE_REF,
        durationSec: 3600,
        version: 2,
      });
      expect(res.headers.etag).toBe('W/"2"');
      expect(await rowCount(eventId)).toBe(1);
    });

    it("014 EARS-1: a source correction that names a provider its reference cannot belong to shall be refused with 400 VALIDATION_FAILED and change nothing", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${eventId}/recordings/${row.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "if-match": 'W/"1"',
          "idempotency-key": key(),
        },
        // A rutube id under the youtube provider — the shared 006 embed-ref
        // shapes are what refuse it, not a second 014-only validator.
        payload: { provider: "youtube", embedRef: RUTUBE_REF },
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      expect((await dbRow(row.id))!.version).toBe(1);
    });

    // ── EARS-2 — the recording's own publication lifecycle ─────────────────

    it("014 EARS-2: when a draft recording of an ended event is published, the system shall move only that row and set first_published_at once", async () => {
      const eventId = await insertEvent("ended");
      const edited = await attached(eventId);
      const raw = await attached(
        eventId,
        attachPayload({
          kind: "raw",
          provider: "youtube",
          embedRef: YOUTUBE_REF,
        }),
      );

      const published = await commanded(eventId, edited.id, "publish", 1);
      expect(published).toMatchObject({ status: "published", version: 2 });
      expect(published.firstPublishedAt).not.toBeNull();
      // Only that row moved, and the EVENT's own state is untouched.
      expect((await dbRow(raw.id))!.status).toBe("draft");
      expect(await eventState(eventId)).toBe("ended");

      const firstInstant = (await dbRow(edited.id))!.first_published_at;
      const drafted = await commanded(eventId, edited.id, "unpublish", 2);
      expect(drafted.status).toBe("draft");
      // Unpublish never clears the publication instant …
      expect((await dbRow(edited.id))!.first_published_at).toEqual(
        firstInstant,
      );
      const republished = await commanded(eventId, edited.id, "publish", 3);
      expect(republished.status).toBe("published");
      // … and a second publish keeps the ORIGINAL one.
      expect((await dbRow(edited.id))!.first_published_at).toEqual(
        firstInstant,
      );
    });

    it.each(["draft", "published", "live", "archived"])(
      "014 EARS-2: publishing a recording of a %s event shall be refused with 409 EVENT_NOT_FINISHED, leaving both the recording and the event untouched",
      async (state) => {
        const eventId = await insertEvent(state);
        const row = await attached(eventId);
        const res = await command(eventId, row.id, "publish", { version: 1 });
        expect(res.statusCode).toBe(409);
        expect(problem(res).errorCode).toBe("EVENT_NOT_FINISHED");
        const after = (await dbRow(row.id))!;
        expect(after.status).toBe("draft");
        expect(after.version).toBe(1);
        expect(after.first_published_at).toBeNull();
        // 014 never moves the event's lifecycle state — not even as a side
        // effect of a refusal.
        expect(await eventState(eventId)).toBe(state);
      },
    );

    it("014 EARS-2: retiring a recording shall free the (event, kind) slot while the row stays addressable, and the freed slot shall accept a fresh attach", async () => {
      const eventId = await insertEvent("ended");
      const first = await attached(eventId);
      const retired = await commanded(eventId, first.id, "retire", 1);
      expect(retired.status).toBe("retired");
      expect(retired.deletedAt).not.toBeNull();

      // The slot is free …
      const second = await attached(
        eventId,
        attachPayload({ embedRef: RUTUBE_REF_2 }),
      );
      expect(second.status).toBe("draft");
      // … and NOTHING was removed: both rows are still there and the retired one
      // is still addressable through the list.
      expect(await rowCount(eventId)).toBe(2);
      const listBody = JSON.parse((await list(eventId)).payload) as {
        data: RecordingBody[];
      };
      expect(listBody.data.map((r) => r.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
    });

    it("014 EARS-2: restoring a retired recording into an occupied slot shall be refused with 409 RECORDING_KIND_OCCUPIED, and shall succeed once the slot is free", async () => {
      const eventId = await insertEvent("ended");
      const first = await attached(eventId);
      await commanded(eventId, first.id, "retire", 1);
      const second = await attached(
        eventId,
        attachPayload({ embedRef: RUTUBE_REF_2 }),
      );

      const refused = await command(eventId, first.id, "restore", {
        version: 2,
      });
      expect(refused.statusCode).toBe(409);
      expect(problem(refused).errorCode).toBe("RECORDING_KIND_OCCUPIED");
      expect((await dbRow(first.id))!.status).toBe("retired");

      await commanded(eventId, second.id, "retire", 1);
      const restored = await commanded(eventId, first.id, "restore", 2);
      expect(restored).toMatchObject({ status: "draft", version: 3 });
      expect(restored.deletedAt).toBeNull();
    });

    it("014 EARS-2: an edge outside the transition table shall be refused with 409 INVALID_TRANSITION and change nothing", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const res = await command(eventId, row.id, "unpublish", { version: 1 });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("INVALID_TRANSITION");
      expect((await dbRow(row.id))!.version).toBe(1);
    });

    it("014 EARS-2: no delete path exists — DELETE on a recording and a delete-shaped command shall both 404, and the row shall survive", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const del = await app.inject({
        method: "DELETE",
        url: `/v1/admin/events/${eventId}/recordings/${row.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(del.statusCode).toBe(404);
      const asCommand = await command(eventId, row.id, "delete", {
        version: 1,
      });
      expect(asCommand.statusCode).toBe(404);
      expect(await rowCount(eventId)).toBe(1);
    });

    it("014 EARS-2: a recording of another event shall be 404, never acted on through the wrong event's path", async () => {
      const eventId = await insertEvent("ended");
      const otherId = await insertEvent("ended");
      const row = await attached(eventId);
      const res = await command(otherId, row.id, "publish", { version: 1 });
      expect(res.statusCode).toBe(404);
      expect((await dbRow(row.id))!.status).toBe("draft");
    });

    // ── EARS-17 — the write protocol ───────────────────────────────────────

    it("014 EARS-17: an attach without an Idempotency-Key shall be refused 428 IDEMPOTENCY_KEY_REQUIRED and persist nothing", async () => {
      const eventId = await insertEvent("ended");
      const res = await attach(eventId, attachPayload(), {
        idempotencyKey: "",
      });
      expect(res.statusCode).toBe(428);
      expect(problem(res).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(await rowCount(eventId)).toBe(0);
    });

    it("014 EARS-17: an attach with a non-canonical Idempotency-Key shall be refused 400 IDEMPOTENCY_KEY_INVALID and persist nothing", async () => {
      const eventId = await insertEvent("ended");
      const res = await attach(eventId, attachPayload(), {
        idempotencyKey: "not-a-uuid",
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("IDEMPOTENCY_KEY_INVALID");
      expect(await rowCount(eventId)).toBe(0);
    });

    it("014 EARS-17: an exact retry of an attach shall replay the stored outcome instead of attaching a second recording", async () => {
      const eventId = await insertEvent("ended");
      const k = key();
      const first = await attach(eventId, attachPayload(), {
        idempotencyKey: k,
      });
      expect(first.statusCode).toBe(201);
      const retry = await attach(eventId, attachPayload(), {
        idempotencyKey: k,
      });
      expect(retry.statusCode).toBe(201);
      expect(JSON.parse(retry.payload)).toEqual(JSON.parse(first.payload));
      expect(await rowCount(eventId)).toBe(1);
    });

    it("014 EARS-17: a lifecycle command without an If-Match shall be refused 428 PRECONDITION_REQUIRED and change nothing", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const res = await command(eventId, row.id, "publish", {});
      expect(res.statusCode).toBe(428);
      expect(problem(res).errorCode).toBe("PRECONDITION_REQUIRED");
      expect((await dbRow(row.id))!.status).toBe("draft");
    });

    it("014 EARS-17: a lifecycle command with an unusable or stale If-Match shall be refused 412 PRECONDITION_FAILED and change nothing", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const junk = await command(eventId, row.id, "publish", {
        version: "not-a-validator",
      });
      expect(junk.statusCode).toBe(412);
      expect(problem(junk).errorCode).toBe("PRECONDITION_FAILED");
      const stale = await command(eventId, row.id, "publish", { version: 7 });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");
      expect((await dbRow(row.id))!.status).toBe("draft");
    });

    it("014 EARS-17: the recording surface shall refuse an anonymous caller and a doctor_guest session, and persist nothing", async () => {
      const eventId = await insertEvent("ended");
      const anon = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${eventId}/recordings`,
        headers: { ...device, "content-type": "application/json" },
        payload: attachPayload(),
      });
      expect(anon.statusCode).toBe(401);
      const doctor = await attach(eventId, attachPayload(), {
        cookie: await doctorCookie(),
      });
      expect(doctor.statusCode).toBe(401);
      const anonList = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${eventId}/recordings`,
      });
      expect(anonList.statusCode).toBe(401);
      expect(await rowCount(eventId)).toBe(0);
    });

    it("014 EARS-1: when a recording mutation commits, feature 010 shall hold an audit row attributed to the acting admin", async () => {
      const eventId = await insertEvent("ended");
      const row = await attached(eventId);
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [row.id],
      );
      expect(rows.map((r) => r.event_type)).toContain(
        "data.event_recordings.insert",
      );
      expect(rows[0]!.subject_id).not.toBeNull();
    });
  },
);

// ── The DB half: the migration itself ──────────────────────────────────────
//
// Every assertion below is about a constraint the DATABASE enforces, not one the
// service happens to check. A service-only guarantee would be bypassable by a
// script, a psql session or a future handler — and "nothing is ever deleted" and
// "the publication instant is set once" are invariants of the ROW.
describe.skipIf(!process.env.DATABASE_URL)(
  "014 EARS-1: event_recordings schema and migration (e2e)",
  () => {
    let pool: pg.Pool;
    const eventIds: string[] = [];

    beforeAll(async () => {
      const { default: pgModule } = await import("pg");
      pool = new pgModule.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      for (const id of eventIds.splice(0)) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      await pool.end();
    });

    async function seedEvent(state = "ended"): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state)
         VALUES ($1, 'Мероприятие 1339', 'Кардиология сегодня',
                 now() - interval '2 days', 90, $2)
         RETURNING id`,
        [`rec-db-1339-${randomUUID()}`, state],
      );
      const id = rows[0]!.id;
      eventIds.push(id);
      return id;
    }

    async function insertRecording(
      eventId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row: Record<string, unknown> = {
        event_id: eventId,
        kind: "edited",
        provider: "rutube",
        embed_ref: RUTUBE_REF,
        ...overrides,
      };
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_recordings (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        cols.map((c) => row[c]),
      );
      return rows[0]!.id;
    }

    it("014 EARS-1: the migration shall create both enums with exactly the spec's labels", async () => {
      const { rows } = await pool.query<{ typname: string; labels: string[] }>(
        `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname IN ('recording_kind', 'recording_status')
          GROUP BY t.typname ORDER BY t.typname`,
      );
      expect(rows).toEqual([
        { typname: "recording_kind", labels: ["edited", "raw"] },
        {
          typname: "recording_status",
          labels: ["draft", "published", "retired"],
        },
      ]);
    });

    it("014 EARS-1: the migration shall create both partial indexes, the unique one scoped to the non-retired rows", async () => {
      const { rows } = await pool.query<{
        indexname: string;
        indexdef: string;
      }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename = 'event_recordings' ORDER BY indexname`,
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
      const uniq = byName.get("event_recordings_event_kind_active_uniq");
      expect(uniq).toBeDefined();
      expect(uniq).toMatch(/CREATE UNIQUE INDEX/);
      // The predicate is what makes a RETIRED row release the slot.
      expect(uniq).toMatch(/WHERE \(deleted_at IS NULL\)/);
      const published = byName.get("event_recordings_event_published_idx");
      expect(published).toBeDefined();
      expect(published).toMatch(/status = 'published'/);
      expect(published).toMatch(/deleted_at IS NULL/);
    });

    it("014 EARS-1: the event FK shall be RESTRICT — no cascade path can remove a recording", async () => {
      const { rows } = await pool.query<{ confdeltype: string }>(
        `SELECT confdeltype FROM pg_constraint
          WHERE conrelid = 'event_recordings'::regclass AND contype = 'f'`,
      );
      // 'r' = RESTRICT. 'c' (cascade) or 'n' (set null) would mean an event
      // delete could take its recordings with it (014-design §2, ADR-0003 §4).
      expect(rows.map((r) => r.confdeltype)).toEqual(["r"]);

      // Deliberately a RAW parent delete, not `deleteEventFixture` — the
      // fixture helper clears children in FK order precisely so teardown can
      // succeed, which would hide the very refusal this case asserts.
      const eventId = await seedEvent();
      await insertRecording(eventId);
      await expect(
        pool.query(`DELETE FROM events WHERE id = $1`, [eventId]),
      ).rejects.toThrow(/foreign key|violates/i);
    });

    it("014 EARS-1: the at-most-one-per-kind index shall refuse a second non-retired row and admit one once the holder is retired", async () => {
      const eventId = await seedEvent();
      await insertRecording(eventId);
      await expect(
        insertRecording(eventId, { embed_ref: RUTUBE_REF_2 }),
      ).rejects.toThrow(/event_recordings_event_kind_active_uniq/);
      // Retiring releases the slot; the retired row keeps its id and history.
      await pool.query(
        `UPDATE event_recordings SET status = 'retired', deleted_at = now()
          WHERE event_id = $1`,
        [eventId],
      );
      await expect(
        insertRecording(eventId, { embed_ref: RUTUBE_REF_2 }),
      ).resolves.toBeTypeOf("string");
    });

    it("014 EARS-2: the CHECKs shall pin retired ⇔ deleted_at and refuse a published row with no publication instant", async () => {
      const eventId = await seedEvent();
      // Half-retired in either direction is refused.
      await expect(
        insertRecording(eventId, { status: "retired" }),
      ).rejects.toThrow(/event_recordings_retired_iff_deleted/);
      await expect(
        insertRecording(eventId, { deleted_at: new Date() }),
      ).rejects.toThrow(/event_recordings_retired_iff_deleted/);
      await expect(
        insertRecording(eventId, { status: "published" }),
      ).rejects.toThrow(/event_recordings_published_has_first_published_at/);
    });

    it("014 EARS-1: the bound CHECKs shall refuse an empty source reference and a non-positive duration", async () => {
      const eventId = await seedEvent();
      await expect(insertRecording(eventId, { embed_ref: "" })).rejects.toThrow(
        /event_recordings_embed_ref_bounds/,
      );
      await expect(
        insertRecording(eventId, { duration_sec: 0 }),
      ).rejects.toThrow(/event_recordings_duration_bounds/);
      await expect(insertRecording(eventId, { version: 0 })).rejects.toThrow(
        /event_recordings_version_positive/,
      );
    });

    it("014 EARS-2: the set-once trigger shall refuse clearing or moving first_published_at", async () => {
      const eventId = await seedEvent();
      const id = await insertRecording(eventId, {
        status: "published",
        first_published_at: new Date("2026-08-01T10:00:00Z"),
      });
      await expect(
        pool.query(
          "UPDATE event_recordings SET first_published_at = NULL, status = 'draft' WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/set once/);
      await expect(
        pool.query(
          "UPDATE event_recordings SET first_published_at = now() WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/set once/);
    });

    it("014 EARS-1: the table shall carry the feature-010 audit trigger, and events shall carry the nullable recording_expected_by date", async () => {
      const { rows: triggers } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'event_recordings'::regclass AND NOT tgisinternal
          ORDER BY tgname`,
      );
      expect(triggers.map((t) => t.tgname)).toEqual([
        "event_recordings_audit",
        "event_recordings_first_published_at_set_once",
      ]);

      const { rows: cols } = await pool.query<{
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'recording_expected_by'`,
      );
      expect(cols[0]).toEqual({ data_type: "date", is_nullable: "YES" });
    });
  },
);
