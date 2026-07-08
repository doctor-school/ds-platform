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

// 005 EARS-9 — registration lifecycle gating. The `RegisterForEvent` command is
// OFFERED/accepted while the event is `published` (upcoming) or `live`
// (register-during-live is a normal path leading straight toward the room — the
// portal routing target is asserted in `apps/portal/e2e/event-page-registered.
// spec.ts`), and REFUSED with a 4xx for `ended`/`archived`: no registration is
// recorded and the offending state is echoed. Gating derives PURELY from the
// single `EventLifecycleState` — there is NO per-event configurable cutoff beyond
// event state (owner decision 2026-07-06): a `published` event whose start is
// already in the past is still registrable, and an `ended` event whose start is
// in the future is still refused — the lifecycle STATE, never the clock, gates.
// (`draft` is not publicly reachable — 004 EARS-6 — so it is never presented for
// registration; the command fail-closed refuses it too.)
//
// The gating rule itself ships with EARS-1 (`isRegistrable` + the service's
// `EventNotRegistrableError` → 409 mapping); this handler is its EXHAUSTIVE
// verification across the full lifecycle set, the ended/archived refusal the
// EARS-1 spec deferred here. Event authoring / lifecycle transitions are owned by
// feature 007 (tracked seam → parent #564), so this spec SEEDS events directly in
// each target state. Runs against the dev-stand Postgres + the fake IdP for the
// session; skips when DATABASE_URL or IDP_ISSUER is absent so the shared CI unit
// job stays green (requirements Verification, row 9).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-9 registration lifecycle gating (e2e)",
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
     * Seed one event row directly in the target lifecycle state, at an optional
     * `startsAt` — the 005↔007 fixture seam (lifecycle transitions are feature
     * 007). `startsAt` defaults to a future instant; a caller passes a PAST
     * instant to prove gating is state-driven, not clock-driven (no cutoff).
     */
    async function seedEvent(
      state: SeedState,
      startsAt = "2026-07-17T16:00:00.000Z",
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `gate-${state}-${id.slice(0, 8)}`;
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
          startsAt,
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

    function cookieHeader(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    async function eventRegistrationCount(eventId: string): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM registrations WHERE event_id = $1",
        [eventId],
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

    // --- EARS-9.1: registration is OFFERED/accepted for published + live ---
    it.each(["published", "live"] as const)(
      "EARS-9.1: when the event is %s, the system shall offer registration — the RegisterForEvent command is accepted and records a registration",
      async (state) => {
        const { id: eventId, slug } = await seedEvent(state);
        const cookie = await doctorSession(uniqueEmail("doc"));

        const res = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/registration`,
          headers: cookieHeader(cookie),
        });
        expect(res.statusCode).toBe(200);
        expect((res.json() as { registered: boolean }).registered).toBe(true);
        // register-during-live (state === "live") is a normal happy path: the
        // command records exactly as it does for an upcoming event; the portal
        // then routes the doctor toward the room (feature 006, asserted in the
        // portal E2E). Gating never distinguishes the two registrable states.
        expect(await eventRegistrationCount(eventId)).toBe(1);
      },
    );

    // --- EARS-9.2: registration is REFUSED (4xx) for ended + archived ---
    it.each(["ended", "archived"] as const)(
      "EARS-9.2: when the event is %s, the system shall refuse RegisterForEvent with a 4xx and record no registration",
      async (state) => {
        const { id: eventId, slug } = await seedEvent(state);
        const cookie = await doctorSession(uniqueEmail("doc"));

        const res = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/registration`,
          headers: cookieHeader(cookie),
        });
        // The command is refused with a client-error state conflict (409 ∈ 4xx),
        // never silently satisfied; the response echoes the offending state.
        expect(res.statusCode).toBe(409);
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect((res.json() as { state?: string }).state).toBe(state);

        // No registration row was created for the refused state.
        expect(await eventRegistrationCount(eventId)).toBe(0);
      },
    );

    // `draft` is not publicly reachable (004 EARS-6); the command still
    // fail-closed refuses it — a draft is never registrable by construction.
    it("EARS-9.2: a draft event (not publicly reachable) is likewise refused, never registrable", async () => {
      const { id: eventId, slug } = await seedEvent("draft");
      const cookie = await doctorSession(uniqueEmail("doc"));

      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { state?: string }).state).toBe("draft");
      expect(await eventRegistrationCount(eventId)).toBe(0);
    });

    // --- EARS-9.3: gating derives PURELY from EventLifecycleState (no cutoff) ---
    it("EARS-9.3: gating derives from lifecycle state alone — a published event whose start is already in the past is still registrable (no per-event time cutoff)", async () => {
      // starts_at in the past, but the event is still `published` (007 has not
      // transitioned it to `ended`). No configurable cutoff beyond state exists,
      // so registration is still OFFERED.
      const { id: eventId, slug } = await seedEvent(
        "published",
        "2020-01-01T00:00:00.000Z",
      );
      const cookie = await doctorSession(uniqueEmail("doc"));

      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
      expect(await eventRegistrationCount(eventId)).toBe(1);
    });

    it("EARS-9.3: gating derives from lifecycle state alone — an ended event whose start is in the future is still refused (the state gates, not the clock)", async () => {
      // starts_at in the far future, but the event is `ended`: the STATE, not the
      // clock, is the gate, so registration is refused.
      const { id: eventId, slug } = await seedEvent(
        "ended",
        "2099-01-01T00:00:00.000Z",
      );
      const cookie = await doctorSession(uniqueEmail("doc"));

      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { state?: string }).state).toBe("ended");
      expect(await eventRegistrationCount(eventId)).toBe(0);
    });

    it("EARS-9.3: no per-event registration-cutoff configuration exists — the events row carries no cutoff/deadline column, so gating can only derive from state", async () => {
      // Structural guard: gating is a pure function of `EventLifecycleState`, so
      // no per-event cutoff/deadline/registration-close column may exist to gate
      // on. If a future change adds one, this assertion fails loudly (owner
      // decision 2026-07-06: no cutoff beyond event state).
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'events'`,
      );
      const columns = rows.map((r) => r.column_name.toLowerCase());
      expect(columns).toContain("state");
      for (const forbidden of columns) {
        expect(forbidden).not.toMatch(/cutoff|deadline|registration_close|closes_at/);
      }
    });
  },
);
