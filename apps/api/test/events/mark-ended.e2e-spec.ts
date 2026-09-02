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
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { futureMskStart } from "../setup/wall-clock.js";

// 014 EARS-18 — `MarkEventEnded` (`POST /v1/admin/events/:id/mark-ended`): the
// `published → ended` transition for an эфир the platform never hosted, held
// before features 006/007 existed or run off-platform (014-design §3.1). Without
// it such an event is stuck at `published` and its recording can never clear the
// 014 §3 publish gate.
//
// What these tests pin, beyond "it changes the state":
//
//  1. the THREE server-side preconditions are enforced by the SERVER, not merely
//     hidden in the admin UI — origin `published`, room never opened
//     (`live_at IS NULL`), scheduled end already past;
//  2. every refusal is TOTAL — the state is untouched AND no audit row is
//     written, so a refused command leaves no trace to reconcile;
//  3. the command writes its OWN audit id (`event.marked_ended`), never
//     `event.ended`, so the ledger can still answer «did we host this эфир?»;
//  4. `validTransitions` on the admin read is the derived offer the UI renders,
//     so the control appears exactly when the command would succeed;
//  5. the `Idempotency-Key` protocol (012-design §6 / EARS-17): required,
//     canonical, and a retry REPLAYS rather than re-applying — including a
//     retry of a deterministic 409.
//
// Runs against dev-stand Postgres + the fake IdP session; skips when absent so
// the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-18 MarkEventEnded (e2e)",
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

    /** Register + login; return the session cookie value. `role` is granted before login. */
    async function session(
      email: string,
      role: "doctor_guest" | "platform_admin",
    ): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);

      if (role === "platform_admin") {
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

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      return cookie!.value;
    }

    /** Build a multipart/form-data body from string fields. */
    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds1338${Math.random().toString(16).slice(2)}`;
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

    // The `starts_at` fixtures are derived relative to now, never pinned to a
    // literal date: these tests are ABOUT the past/future boundary, so a hardcoded
    // year would silently flip a case from "refused" to "accepted" with no
    // production change behind it (`test/setup/wall-clock.ts`).
    const PAST = () => futureMskStart(-30, "19:00");
    const FUTURE = () => futureMskStart(30, "19:00");

    /** Create a fresh draft event through the EARS-1 create endpoint; return its id. */
    async function createDraft(
      cookie: string,
      startsAtMsk: string,
    ): Promise<string> {
      const mp = multipartBody({
        payload: JSON.stringify({
          title: "ХСН: эфир вне платформы",
          school: "Кардиология",
          startsAtMsk,
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

    /**
     * The current `If-Match` validator (#1593) — `mark-ended` is conditional
     * like its five siblings. Staleness itself is owned by
     * `test/admin/optimistic-concurrency.e2e-spec.ts`; here the validator is
     * always current so these tests stay about the EARS-18 preconditions.
     */
    async function ifMatch(id: string): Promise<Record<string, string>> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM events WHERE id = $1",
        [id],
      );
      return { "if-match": `"${rows[0]?.version ?? 1}"` };
    }

    /** POST the mark-ended command. A key is supplied unless one is passed explicitly. */
    async function markEnded(
      cookie: string,
      id: string,
      key: string | null = randomUUID(),
      validator?: string,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/mark-ended`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          ...(validator ? { "if-match": validator } : await ifMatch(id)),
          ...(key === null ? {} : { "idempotency-key": key }),
        },
      });
    }

    /** The raw current validator string, for a retry that must repeat the exact request. */
    async function validatorOf(id: string): Promise<string> {
      return (await ifMatch(id))["if-match"]!;
    }

    /** The admin detail read — the source of the `validTransitions` the UI renders. */
    async function adminDetail(cookie: string, id: string) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${id}`,
        headers: { ...device, ...authHeaders(cookie) },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
    }

    async function persistedState(id: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ state: string }>(
        "SELECT state FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.state;
    }

    async function liveAt(id: string): Promise<Date | null> {
      const { rows } = await pool.query<{ live_at: Date | null }>(
        "SELECT live_at FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.live_at ?? null;
    }

    async function auditCount(id: string, eventType: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_ledger
           WHERE event_type = $1 AND metadata->>'aggregateId' = $2`,
        [eventType, id],
      );
      return Number(rows[0]?.count ?? "0");
    }

    /** Force a persisted lifecycle state without running the sibling commands. */
    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [
        state,
        id,
      ]);
    }

    /** Arrange the eligible fixture: past-dated, `published`, room never opened. */
    async function eligibleEvent(cookie: string): Promise<string> {
      const id = await createDraft(cookie, PAST());
      await forceState(id, "published");
      return id;
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

    it("EARS-18: a past-dated published event whose room was never opened is marked ended, with exactly one event.marked_ended row and no event.ended row", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await eligibleEvent(cookie);

      const res = await markEnded(cookie, id);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
      expect(body.state).toBe("ended");
      // `ended` is a real lifecycle state, not a marker: the event carries on to
      // `hidden` exactly as one the platform did host.
      expect(body.validTransitions).toEqual(["hidden"]);
      expect(await persistedState(id)).toBe("ended");

      // The distinct audit id is the point: collapsing it into `event.ended`
      // would make the ledger unable to answer «did we host this broadcast?».
      expect(await auditCount(id, "event.marked_ended")).toBe(1);
      expect(await auditCount(id, "event.ended")).toBe(0);
      // No room was opened, so no go-live instant may appear.
      expect(await liveAt(id)).toBeNull();
    });

    it("EARS-18: the command is refused with 409 EVENT_NOT_PAST while the scheduled end is still in the future, leaving the state and the ledger untouched", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie, FUTURE());
      await forceState(id, "published");

      const res = await markEnded(cookie, id);
      expect(res.statusCode).toBe(409);
      const body = res.json() as { code: string; scheduledEnd: string };
      expect(body.code).toBe("EVENT_NOT_PAST");
      // The refusal names WHEN the command becomes available — an operator who
      // mis-clicked needs the date, not just a rejection.
      expect(new Date(body.scheduledEnd).getTime()).toBeGreaterThan(Date.now());

      expect(await persistedState(id)).toBe("published");
      expect(await auditCount(id, "event.marked_ended")).toBe(0);
    });

    it.each(["draft", "live", "ended", "hidden"] as const)(
      "EARS-18: the command is refused with 409 INVALID_TRANSITION from %s, leaving the state and the ledger untouched",
      async (from) => {
        const cookie = await session(uniqueEmail("admin"), "platform_admin");
        const id = await createDraft(cookie, PAST());
        await forceState(id, from);

        const res = await markEnded(cookie, id);
        expect(res.statusCode).toBe(409);
        expect((res.json() as { code: string }).code).toBe(
          "INVALID_TRANSITION",
        );
        expect(await persistedState(id)).toBe(from);
        expect(await auditCount(id, "event.marked_ended")).toBe(0);
      },
    );

    it("EARS-18: an event whose room was EVER opened is refused with 409 INVALID_TRANSITION even while it is published", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie, PAST());
      // `live_at` is the server-stamped go-live instant and nothing else sets
      // it, so it is the structural proof that the platform hosted this эфир.
      // The state is put back to `published` deliberately: the history of a
      // hosted broadcast must not be rewritable by this edge even then.
      await pool.query(
        "UPDATE events SET state = 'published', live_at = now() WHERE id = $1",
        [id],
      );

      const res = await markEnded(cookie, id);
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe("INVALID_TRANSITION");
      expect(await persistedState(id)).toBe("published");
      expect(await auditCount(id, "event.marked_ended")).toBe(0);
    });

    it("EARS-18: validTransitions offers `ended` only when all three preconditions hold, so the admin control appears exactly when the command would succeed", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");

      const eligible = await eligibleEvent(cookie);
      expect((await adminDetail(cookie, eligible)).validTransitions).toEqual([
        "live",
        "ended",
      ]);

      const future = await createDraft(cookie, FUTURE());
      await forceState(future, "published");
      expect((await adminDetail(cookie, future)).validTransitions).toEqual([
        "live",
      ]);

      const everLive = await createDraft(cookie, PAST());
      await pool.query(
        "UPDATE events SET state = 'published', live_at = now() WHERE id = $1",
        [everLive],
      );
      expect((await adminDetail(cookie, everLive)).validTransitions).toEqual([
        "live",
      ]);
    });

    it("EARS-18: a missing Idempotency-Key is refused with 428 and a non-canonical one with 400, before the command runs", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await eligibleEvent(cookie);

      const absent = await markEnded(cookie, id, null);
      expect(absent.statusCode).toBe(428);
      expect((absent.json() as { code: string }).code).toBe(
        "IDEMPOTENCY_KEY_REQUIRED",
      );

      const malformed = await markEnded(cookie, id, "not-a-uuid");
      expect(malformed.statusCode).toBe(400);
      expect((malformed.json() as { code: string }).code).toBe(
        "IDEMPOTENCY_KEY_INVALID",
      );

      // Neither refusal reached the command.
      expect(await persistedState(id)).toBe("published");
      expect(await auditCount(id, "event.marked_ended")).toBe(0);
    });

    it("EARS-18: replaying the same Idempotency-Key returns the stored outcome without applying the transition a second time", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await eligibleEvent(cookie);
      const key = randomUUID();
      // A genuine retry repeats the request byte for byte — the SAME validator
      // included (#1593 binds `If-Match` into the idempotency fingerprint, so a
      // retry that silently re-read it would be a different request).
      const validator = await validatorOf(id);

      const first = await markEnded(cookie, id, key, validator);
      expect(first.statusCode).toBe(200);

      const replay = await markEnded(cookie, id, key, validator);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      // The record replayed; the ledger still holds exactly one row.
      expect(await auditCount(id, "event.marked_ended")).toBe(1);
    });

    it("EARS-18: the same Idempotency-Key against a different event is refused as a reuse, never replayed", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const first = await eligibleEvent(cookie);
      const other = await eligibleEvent(cookie);
      const key = randomUUID();

      expect((await markEnded(cookie, first, key)).statusCode).toBe(200);

      const reused = await markEnded(cookie, other, key);
      expect(reused.statusCode).toBe(409);
      expect((reused.json() as { code: string }).code).toBe(
        "IDEMPOTENCY_KEY_REUSED",
      );
      // The second event is untouched — a replayed body would have silently
      // reported someone else's command as this one's outcome.
      expect(await persistedState(other)).toBe("published");
      expect(await auditCount(other, "event.marked_ended")).toBe(0);
    });

    it("EARS-18: a deterministic 409 is stored, so retrying the key replays that exact refusal instead of re-deciding it", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie, FUTURE());
      await forceState(id, "published");
      const key = randomUUID();

      const first = await markEnded(cookie, id, key);
      expect(first.statusCode).toBe(409);
      expect((first.json() as { code: string }).code).toBe("EVENT_NOT_PAST");

      const replay = await markEnded(cookie, id, key);
      expect(replay.statusCode).toBe(409);
      expect(replay.json()).toEqual(first.json());
      expect(await persistedState(id)).toBe("published");
    });

    it("EARS-8: a doctor_guest and an anonymous caller are refused before the handler, with no state change", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const id = await eligibleEvent(admin);

      const guest = await session(uniqueEmail("guest"), "doctor_guest");
      const asGuest = await markEnded(guest, id);
      // 011 EARS-2: refused 401, not 403 — since the admin tier, a doctor-portal
      // cookie authenticates NO admin route, so the request never reaches the
      // role check (identical to the sibling 007 transition command).
      expect(asGuest.statusCode).toBe(401);

      const anonymous = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/mark-ended`,
        headers: { ...device, "idempotency-key": randomUUID() },
      });
      expect(anonymous.statusCode).toBe(401);

      expect(await persistedState(id)).toBe("published");
      expect(await auditCount(id, "event.marked_ended")).toBe(0);
    });
  },
);
