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
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { REGISTRATION_CREATED_AUDIT_TYPE } from "../../src/registration/registration.repository.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 005 EARS-3 — the one-registration invariant + idempotent RegisterForEvent
// (design §2; ADR-0003 §5/§6). One doctor + one event = AT MOST ONE
// registration, regardless of how many times or through which path (one-tap,
// guest-through-auth, «мои события» re-entry) the doctor registers; a repeat is
// an idempotent no-op returning the existing registration — it creates no
// duplicate row and emits no second `DoctorRegisteredForEvent` / terminal
// `audit_ledger` entry. The invariant is enforced by the DB `UNIQUE
// (user_id, event_id)` constraint (asserted directly below), not by client
// discipline; the write is an `INSERT … ON CONFLICT DO NOTHING` + read-back.
//
// EARS-3 carries multiple shall-clauses, so the tests are nested `3.M` per
// ADR-0006 §4: 3.1 same-path repeat, 3.2 cross-path (slug then id), 3.3 the
// DB-level uniqueness constraint, 3.4 the exactly-one-then-none audit row.
//
// Events authoring/lifecycle is owned by feature 007 (tracked seam → parent
// #564), so this spec SEEDS events directly. Runs against the dev-stand Postgres
// + the fake IdP for the session; skips when DATABASE_URL or IDP_ISSUER is absent
// so the shared CI unit job stays green (requirements Verification, row 3).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-3 one-registration invariant (e2e)",
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

    /** Seed one published event directly — the 005↔007 fixture seam. */
    async function seedEvent(): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `reg-idem-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          "Актуальная терапия ХСН",
          "Кардиология сегодня",
          "2026-07-17T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          "published",
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    async function doctorSession(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
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

    async function userIdByEmail(email: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]).toBeDefined();
      return rows[0]!.id;
    }

    async function registrationCount(
      userId: string,
      eventId: string,
    ): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM registrations WHERE user_id = $1 AND event_id = $2",
        [userId, eventId],
      );
      return Number(rows[0]?.n ?? 0);
    }

    /**
     * Count terminal `webinar.registration.created` audit rows for this event
     * since the given instant. Scoped by `created_at >= since` and the event id
     * in metadata so a re-used fake `sub` from an earlier run cannot leak in
     * (the fake-sub collision precedent — audit_ledger is append-only).
     */
    async function auditCount(eventId: string, since: Date): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM audit_ledger
          WHERE event_type = $1
            AND metadata->>'eventId' = $2
            AND created_at >= $3`,
        [REGISTRATION_CREATED_AUDIT_TYPE, eventId, since.toISOString()],
      );
      return Number(rows[0]?.n ?? 0);
    }

    async function register(slugOrId: string, cookie: string) {
      return app.inject({
        method: "POST",
        url: `/v1/events/${slugOrId}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
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
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-3.1: when a doctor registers for the same event twice via the same path, the system records exactly one row and the repeat is a no-op returning the existing registration", async () => {
      const { id: eventId, slug } = await seedEvent();
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const userId = await userIdByEmail(email);

      const first = await register(slug, cookie);
      expect(first.statusCode).toBe(200);
      const firstBody = first.json() as {
        registered: boolean;
        registeredAt: string;
      };
      expect(firstBody.registered).toBe(true);

      const second = await register(slug, cookie);
      expect(second.statusCode).toBe(200);
      const secondBody = second.json() as {
        registered: boolean;
        registeredAt: string;
      };
      // No-op: the repeat returns the SAME existing registration, not a new one.
      expect(secondBody.registered).toBe(true);
      expect(secondBody.registeredAt).toBe(firstBody.registeredAt);

      // Exactly one durable row survives both calls.
      expect(await registrationCount(userId, eventId)).toBe(1);
    });

    it("EARS-3.2: when a doctor registers via the event slug and then via its id, the system still records exactly one registration (no path creates a duplicate)", async () => {
      const { id: eventId, slug } = await seedEvent();
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const userId = await userIdByEmail(email);

      const bySlug = await register(slug, cookie);
      expect(bySlug.statusCode).toBe(200);
      const byId = await register(eventId, cookie);
      expect(byId.statusCode).toBe(200);

      expect((byId.json() as { registered: boolean }).registered).toBe(true);
      // The slug path and the id path key the SAME (user_id, event_id) row.
      expect(await registrationCount(userId, eventId)).toBe(1);
    });

    it("EARS-3.3: the (user_id, event_id) uniqueness invariant is enforced at the DB level — a raw duplicate insert is rejected (23505), not by client discipline", async () => {
      const { id: eventId, slug } = await seedEvent();
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const userId = await userIdByEmail(email);

      const first = await register(slug, cookie);
      expect(first.statusCode).toBe(200);

      // Bypass the service and attempt a raw second row for the same pair: the
      // database itself must reject it with a unique_violation.
      let code: string | undefined;
      try {
        await pool.query(
          "INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)",
          [userId, eventId],
        );
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      expect(code).toBe("23505");
      expect(await registrationCount(userId, eventId)).toBe(1);
    });

    it("EARS-3.4: the registration emits exactly one terminal audit_ledger row on first insert and none on an idempotent repeat", async () => {
      const { id: eventId, slug } = await seedEvent();
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);

      const since = new Date();
      const first = await register(slug, cookie);
      expect(first.statusCode).toBe(200);
      // First insert → exactly one terminal audit row.
      expect(await auditCount(eventId, since)).toBe(1);

      const second = await register(slug, cookie);
      expect(second.statusCode).toBe(200);
      // Idempotent repeat → still exactly one; no second row was appended.
      expect(await auditCount(eventId, since)).toBe(1);
    });
  },
);
