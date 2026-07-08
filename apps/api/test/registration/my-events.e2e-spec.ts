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

// 005 EARS-6 — the `MyEvents` read model (GET /v1/me/events) + its EARS-10
// doctor_guest classification. The authenticated doctor's «мои события»
// Предстоящие list: their registered UPCOMING events (published/live, future or
// currently airing), ordered NEAREST startsAt first, each item
// { eventId, slug, title, school, startsAt, state }. ended/archived registrations
// and OTHER doctors' registrations are absent — the read returns only the
// caller's own (EARS-10). An unauthenticated caller is refused (401), never
// silently satisfied.
//
// Event authoring / lifecycle transitions are owned by feature 007 (tracked seam
// → parent #564), so this spec SEEDS events directly in each target lifecycle
// state and at explicit start instants. Runs against the dev-stand Postgres + the
// fake IdP for the session; skips when DATABASE_URL or IDP_ISSUER is absent so the
// shared CI unit job stays green (requirements Verification, row 6).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-6 my events read model (e2e)",
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

    /** Seed one event row directly in a target lifecycle state at a given start instant (005↔007 fixture seam). */
    async function seedEvent(
      state: SeedState,
      startsAt: string,
      title: string,
      school: string,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `me-${state}-${id.slice(0, 8)}`;
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

    /** Register the session's doctor for `slug` via the real one-tap command. */
    async function register(cookie: string, slug: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(200);
    }

    async function myEvents(cookie: string): Promise<MyEventItem[]> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as MyEventItem[];
    }

    // Instants: a future-published (furthest), a nearer future-published, and a
    // just-started live (past start, currently airing). NEAREST-first order must
    // interleave them by startsAt: live(now-ish) < near-published < far-published.
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

    it("EARS-6.1: MyEvents lists the caller's registered published/live events ordered nearest startsAt first, each with slug/title/school/startsAt/state", async () => {
      // A live event airing now (start just in the past), a near-future published
      // event, and a far-future published event — registered out of time order.
      const far = await seedEvent(
        "published",
        iso(3 * DAY),
        "ХСН: амбулаторное ведение",
        "Школа кардиологии",
      );
      const live = await seedEvent(
        "live",
        iso(-20 * 60 * 1000),
        "Пластика ахиллова сухожилия",
        "Школа травматологии",
      );
      const near = await seedEvent(
        "published",
        iso(1 * DAY),
        "Старт инсулинотерапии",
        "Школа эндокринологии",
      );

      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      await register(cookie, far.slug);
      await register(cookie, live.slug);
      await register(cookie, near.slug);

      const list = await myEvents(cookie);
      // Nearest-first: live (now-ish) → near (+1d) → far (+3d).
      expect(list.map((e) => e.eventId)).toEqual([live.id, near.id, far.id]);

      const first = list[0]!;
      expect(first).toMatchObject({
        eventId: live.id,
        slug: live.slug,
        title: "Пластика ахиллова сухожилия",
        school: "Школа травматологии",
        state: "live",
      });
      expect(typeof first.startsAt).toBe("string");
      expect(Number.isNaN(Date.parse(first.startsAt))).toBe(false);
      expect(list.map((e) => e.state)).toEqual(["live", "published", "published"]);
    });

    it("EARS-6.2: ended/archived registrations are absent — only published/live upcoming events appear", async () => {
      const published = await seedEvent(
        "published",
        iso(1 * DAY),
        "Актуальная терапия",
        "Школа терапии",
      );
      const ended = await seedEvent(
        "ended",
        iso(-2 * DAY),
        "Завершённый эфир",
        "Школа неврологии",
      );
      const archived = await seedEvent(
        "archived",
        iso(-10 * DAY),
        "Архивный эфир",
        "Школа пульмонологии",
      );

      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      // The gating command refuses ended/archived, so seed those registrations
      // directly (a doctor registered while the event was live, then it ended).
      await register(cookie, published.slug);
      const userId = (
        await pool.query<{ id: string }>(
          "SELECT id FROM users WHERE email = $1",
          [email],
        )
      ).rows[0]!.id;
      for (const ev of [ended, archived]) {
        await pool.query(
          "INSERT INTO registrations (user_id, event_id) VALUES ($1,$2)",
          [userId, ev.id],
        );
      }

      const list = await myEvents(cookie);
      expect(list.map((e) => e.eventId)).toEqual([published.id]);
    });

    it("EARS-10: MyEvents returns only the caller's own registrations — never another doctor's", async () => {
      const mine = await seedEvent(
        "published",
        iso(1 * DAY),
        "Моё событие",
        "Школа A",
      );
      const theirs = await seedEvent(
        "published",
        iso(1 * DAY),
        "Чужое событие",
        "Школа B",
      );

      const meEmail = uniqueEmail("me");
      const otherEmail = uniqueEmail("other");
      const meCookie = await doctorSession(meEmail);
      const otherCookie = await doctorSession(otherEmail);
      await register(meCookie, mine.slug);
      await register(otherCookie, theirs.slug);

      const list = await myEvents(meCookie);
      // Only my registration — never the other doctor's event.
      expect(list.map((e) => e.eventId)).toEqual([mine.id]);
    });

    it("EARS-6.3: a doctor with no registrations gets a valid empty list", async () => {
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      expect(await myEvents(cookie)).toEqual([]);
    });

    it("EARS-10: an unauthenticated MyEvents read is refused (401) — not silently satisfied", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: device,
      });
      expect(res.statusCode).toBe(401);
    });
  },
);
