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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 005 EARS-1 — RegisterForEvent (POST /v1/events/:idOrSlug/registration) + the
// immediate EventRegistrationState flip + the EARS-10 doctor_guest
// classification. An authenticated doctor activates «Участвовать» on a
// published/live event and a registration is recorded against their account in
// ONE action (no confirmation round-trip); the per-user EventRegistrationState
// read (GET /v1/events/:idOrSlug/registration) flips from `{registered:false}`
// to `{registered:true, registeredAt}` immediately after the write. An
// unauthenticated caller is refused (401), never silently satisfied (EARS-10).
//
// Event authoring / lifecycle transitions are owned by feature 007 (tracked seam
// → parent #564), so this spec SEEDS events directly in each target lifecycle
// state. The one-registration invariant + idempotent repeat (EARS-3), the broader
// per-user reads (EARS-4/6), and the ended/archived gating detail (EARS-9) are
// sibling handlers. Runs against the dev-stand Postgres + the fake IdP for the
// session; skips when DATABASE_URL or IDP_ISSUER is absent so the shared CI unit
// job stays green (requirements Verification, row 1).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-1 register for event (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "published" | "live" | "ended" | "archived";

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /**
     * Seed one event row directly in the target lifecycle state — the 005↔007
     * fixture seam: lifecycle transitions do not exist yet (feature 007), so a
     * registration test seeds the state it gates on.
     */
    async function seedEvent(
      state: SeedState,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `reg-${state}-${id.slice(0, 8)}`;
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
          state,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    /** Register + login a doctor_guest; return the session cookie value. */
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
      // registrations cascade on the event/user delete (FK ON DELETE CASCADE).
      for (const id of createdEventIds.splice(0))
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(["published", "live"] as const)(
      "EARS-1: when an authenticated doctor activates registration on a %s event, the system records exactly one registration in one action and the EventRegistrationState read flips to registered",
      async (state) => {
        const { id: eventId, slug } = await seedEvent(state);
        const email = uniqueEmail("doc");
        const cookie = await doctorSession(email);
        const headers = {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        };
        const userId = await userIdByEmail(email);

        // Before the write: the per-user state is unregistered.
        const before = await app.inject({
          method: "GET",
          url: `/v1/events/${slug}/registration`,
          headers,
        });
        expect(before.statusCode).toBe(200);
        expect(before.json()).toEqual({ registered: false });

        // ONE action records the registration — no confirmation round-trip.
        const res = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/registration`,
          headers,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          registered: boolean;
          registeredAt?: string;
        };
        expect(body.registered).toBe(true);
        expect(typeof body.registeredAt).toBe("string");
        expect(Number.isNaN(Date.parse(body.registeredAt!))).toBe(false);

        // Exactly one durable registration row against this account.
        expect(await registrationCount(userId, eventId)).toBe(1);

        // The EventRegistrationState read flips to registered immediately.
        const after = await app.inject({
          method: "GET",
          url: `/v1/events/${slug}/registration`,
          headers,
        });
        expect(after.statusCode).toBe(200);
        const afterBody = after.json() as {
          registered: boolean;
          registeredAt?: string;
        };
        expect(afterBody.registered).toBe(true);
        expect(afterBody.registeredAt).toBe(body.registeredAt);
      },
    );

    it("EARS-1: registration resolves the event by its public slug or its id — both key the same record", async () => {
      const { id: eventId, slug } = await seedEvent("published");
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const headers = { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
      const userId = await userIdByEmail(email);

      const bySlug = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers,
      });
      expect(bySlug.statusCode).toBe(200);

      // Reading state by the event id resolves the same registration.
      const byId = await app.inject({
        method: "GET",
        url: `/v1/events/${eventId}/registration`,
        headers,
      });
      expect(byId.statusCode).toBe(200);
      expect((byId.json() as { registered: boolean }).registered).toBe(true);
      expect(await registrationCount(userId, eventId)).toBe(1);
    });

    it("EARS-10: an unauthenticated RegisterForEvent is refused (401) — not silently satisfied", async () => {
      const { id: eventId, slug } = await seedEvent("published");

      const post = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: device,
      });
      expect(post.statusCode).toBe(401);

      const get = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/registration`,
        headers: device,
      });
      expect(get.statusCode).toBe(401);

      // No registration row was created for the refused caller.
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1",
        [eventId],
      );
      expect(Number(rows[0]?.n ?? 0)).toBe(0);
    });
  },
);
