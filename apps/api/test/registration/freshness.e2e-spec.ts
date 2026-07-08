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
import type { MyEventItem } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 005 EARS-7 — a just-registered event appears in «мои события» IMMEDIATELY on
// the next read, via ANY registration path. The invariant is the freshness of
// the `MyEvents` read model (GET /v1/me/events) relative to the `RegisterForEvent`
// write (POST /v1/events/:idOrSlug/registration): there is no read-model
// staleness window — the very next `MyEvents` read after a registration reflects
// it, and a just-registered event is never missing from the list.
//
// Both registration paths converge on the same `RegisterForEvent` command
// (design §3): the logged-in ONE-TAP path fires it against an already-established
// session; the GUEST-THROUGH-AUTH path fires it as the deferred completion right
// after the 003 flow establishes the session, carrying the event context through
// the round-trip. This spec asserts the freshness invariant per path — the read
// taken directly after the write (no delay, no second write) already contains the
// event — proving the `MyEvents` read has no staleness window regardless of path.
//
// The read model is a synchronous DB read (no async projection / cache), so the
// invariant holds structurally; this spec is the executable guard that keeps it
// that way (a future async read model or a cache in front of `MyEvents` would
// reintroduce the staleness gap and redden this).
//
// Event authoring / lifecycle transitions are owned by feature 007 (tracked seam
// → parent #564), so this spec SEEDS events directly in their target lifecycle
// state and start instant. Runs against the dev-stand Postgres + the fake IdP for
// the session; skips when DATABASE_URL or IDP_ISSUER is absent so the shared CI
// unit job stays green (requirements Verification, row 7).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-7 my-events freshness (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    type SeedState = "published" | "live";

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Seed one registrable event (005↔007 fixture seam) at a given start instant. */
    async function seedEvent(
      state: SeedState,
      startsAt: string,
      title: string,
      school: string,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `fresh-${state}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          title,
          school,
          startsAt,
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          null,
          null,
          state,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    /** Register + login a doctor_guest (the 003 flow the guest path also completes); return the session cookie. */
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

    /** Fire the single `RegisterForEvent` command both paths converge on. */
    async function register(cookie: string, slug: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { registered: boolean; registeredAt?: string };
      expect(body.registered).toBe(true);
      expect(typeof body.registeredAt).toBe("string");
      return body.registeredAt!;
    }

    /** The «мои события» read whose freshness EARS-7 asserts. */
    async function myEvents(cookie: string): Promise<MyEventItem[]> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as MyEventItem[];
    }

    const nowMs = Date.now();
    const iso = (deltaMs: number) => new Date(nowMs + deltaMs).toISOString();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

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

    it("EARS-7: when a logged-in doctor registers one-tap, the system shall surface that event in «мои события» on the very next read", async () => {
      const event = await seedEvent(
        "published",
        iso(2 * DAY),
        "Старт инсулинотерапии",
        "Школа эндокринологии",
      );

      // A logged-in doctor on the event page (the one-tap trigger): the session
      // is already established before the register act.
      const cookie = await doctorSession(uniqueEmail("onetap"));

      // Before the write: the event is absent from «мои события» (proves the read
      // genuinely reflects the write state, not a coincidental pre-population).
      const before = await myEvents(cookie);
      expect(before.map((e) => e.eventId)).not.toContain(event.id);

      // ONE action registers; the VERY NEXT read (no delay, no second write) must
      // already contain the just-registered event — no staleness window.
      const registeredAt = await register(cookie, event.slug);
      const after = await myEvents(cookie);

      const listed = after.filter((e) => e.eventId === event.id);
      expect(listed).toHaveLength(1); // present exactly once, immediately
      expect(listed[0]).toMatchObject({
        eventId: event.id,
        slug: event.slug,
        title: "Старт инсулинотерапии",
        school: "Школа эндокринологии",
        state: "published",
      });
      // The write returned a real registeredAt and the listed item carries a
      // parseable canonical instant (the read reflects the just-committed row).
      expect(Number.isNaN(Date.parse(registeredAt))).toBe(false);
      expect(Number.isNaN(Date.parse(listed[0]!.startsAt))).toBe(false);
    });

    it("EARS-7: when a guest completes registration through the 003 auth round-trip, the system shall surface that event in «мои события» on the very next read", async () => {
      // Register-during-live is a normal guest path (design §3.2 / EARS-9).
      const event = await seedEvent(
        "live",
        iso(-15 * 60 * 1000),
        "Пластика ахиллова сухожилия",
        "Школа травматологии",
      );

      // The guest-through-auth path: the guest has NO prior session. Tapping
      // «Участвовать» carries the event context into the 003 login/signup flow;
      // on auth success the session is established (this `doctorSession`), and the
      // deferred `RegisterForEvent` fires as the completion (the same command the
      // one-tap path uses, design §3).
      const cookie = await doctorSession(uniqueEmail("guest"));

      // Immediately after the auth round-trip, before the deferred register
      // completes, the list is empty — there is no phantom entry.
      expect(await myEvents(cookie)).toEqual([]);

      // The deferred completion fires; the VERY NEXT read must already contain the
      // event the guest originally chose — the round-trip never lost it and the
      // read has no staleness window.
      await register(cookie, event.slug);
      const after = await myEvents(cookie);

      const listed = after.filter((e) => e.eventId === event.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        eventId: event.id,
        slug: event.slug,
        title: "Пластика ахиллова сухожилия",
        school: "Школа травматологии",
        state: "live",
      });
    });
  },
);
