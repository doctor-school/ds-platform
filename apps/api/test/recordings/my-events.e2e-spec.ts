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
import type { MyEvents } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 014 EARS-9 (#1347) — «Мои события» over the FULL registration history, split
// across exactly the two canvas tabs of 014-design §8.3: «Предстоящие» (default)
// and «Записи». This spec owns the read model behind them,
// `GET /v1/me/events?tab=upcoming|recordings`:
//
//   • `upcoming` is the shipped 005 EARS-6 side, unchanged — published/live,
//     nearest first;
//   • `recordings` is every `ended` registration, newest first, with NO window —
//     a doctor's Записи tab is their whole finished history;
//   • an `ended` event with nothing published is still LISTED, carrying the
//     `preparing` recording projection (that is the badge the row renders);
//   • a `hidden` registration is in NEITHER tab (feature 004 visibility);
//   • `counts` covers both tabs on either request, so the tab bar can label its
//     own inactive side without a second round-trip.
//
// The recording projection is the SAME source-free #1340 contract the public
// archive page consumes — asserted here by publishing a real recording row and
// watching the row's badge move `preparing → montage`, so the doctor's own row and
// the public card can never disagree.
//
// Event authoring / lifecycle transitions are owned by feature 007 (tracked seam
// → parent #564), so this spec SEEDS events directly in each target lifecycle
// state. Runs against the dev-stand Postgres + the fake IdP for the session; skips
// when DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-9 my events tabs (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    type SeedState = "published" | "live" | "ended" | "hidden";

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Seed one event row directly in a target lifecycle state (005↔007 fixture seam). */
    async function seedEvent(
      state: SeedState,
      startsAt: string,
      title: string,
      options: { expectedBy?: string } = {},
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `me14-${state}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state, recording_expected_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          slug,
          title,
          "Школа кардиологии",
          startsAt,
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          null,
          null,
          state,
          options.expectedBy ?? null,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    /** Publish one recording row for `eventId` (the 014 EARS-2 end state, seeded). */
    async function seedPublishedRecording(
      eventId: string,
      kind: "edited" | "raw",
    ): Promise<void> {
      await pool.query(
        `INSERT INTO event_recordings
           (event_id, kind, provider, embed_ref, status, first_published_at)
         VALUES ($1,$2,'rutube',$3,'published', now())`,
        [eventId, kind, `rec${randomUUID().replace(/-/g, "").slice(0, 16)}`],
      );
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

    async function userIdOf(email: string): Promise<string> {
      const rows = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return rows.rows[0]!.id;
    }

    /**
     * Register the doctor for an event directly. The EARS-1 command deliberately
     * REFUSES `ended`/`hidden` events, so a finished registration can only be
     * seeded — it is the real-world shape (registered while published, the event
     * then ended), not a shortcut around the gate.
     */
    async function seedRegistration(
      userId: string,
      eventId: string,
    ): Promise<void> {
      await pool.query(
        "INSERT INTO registrations (user_id, event_id) VALUES ($1,$2)",
        [userId, eventId],
      );
    }

    async function myEvents(
      cookie: string,
      tab?: string,
    ): Promise<MyEvents> {
      const url = tab ? `/v1/me/events?tab=${tab}` : "/v1/me/events";
      const res = await app.inject({
        method: "GET",
        url,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as MyEvents;
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
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("014 EARS-9.1: the default (no ?tab=) read is the Предстоящие tab — published/live only, nearest first", async () => {
      const far = await seedEvent("published", iso(3 * DAY), "Далёкий эфир");
      const live = await seedEvent("live", iso(-20 * 60 * 1000), "Идёт сейчас");
      const near = await seedEvent("published", iso(1 * DAY), "Завтра");
      const ended = await seedEvent("ended", iso(-2 * DAY), "Уже прошёл");

      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const userId = await userIdOf(email);
      for (const ev of [far, live, near, ended])
        await seedRegistration(userId, ev.id);

      const result = await myEvents(cookie);
      expect(result.tab).toBe("upcoming");
      expect(result.data.map((e) => e.eventId)).toEqual([
        live.id,
        near.id,
        far.id,
      ]);
      // The finished registration belongs to the OTHER tab, never this one.
      expect(result.data.map((e) => e.eventId)).not.toContain(ended.id);
      // An upcoming row has no recording state to speak of.
      expect(result.data.every((e) => e.recording === null)).toBe(true);
    });

    it("014 EARS-9.2: ?tab=recordings returns the full ended history newest first, with no window", async () => {
      const recent = await seedEvent("ended", iso(-2 * DAY), "Недавний эфир");
      const older = await seedEvent("ended", iso(-90 * DAY), "Прошлой весной");
      const ancient = await seedEvent("ended", iso(-800 * DAY), "Два года назад");
      const upcoming = await seedEvent("published", iso(1 * DAY), "Завтра");

      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const userId = await userIdOf(email);
      for (const ev of [recent, older, ancient, upcoming])
        await seedRegistration(userId, ev.id);

      const result = await myEvents(cookie, "recordings");
      expect(result.tab).toBe("recordings");
      // Newest first — and the two-year-old registration is STILL listed.
      expect(result.data.map((e) => e.eventId)).toEqual([
        recent.id,
        older.id,
        ancient.id,
      ]);
      expect(result.data.every((e) => e.state === "ended")).toBe(true);
    });

    it("014 EARS-9.3: an ended registration with NO published recording is listed carrying the preparing projection", async () => {
      const ended = await seedEvent("ended", iso(-3 * DAY), "Без записи", {
        expectedBy: "2026-09-15",
      });
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      await seedRegistration(await userIdOf(email), ended.id);

      const result = await myEvents(cookie, "recordings");
      expect(result.data.map((e) => e.eventId)).toEqual([ended.id]);
      expect(result.data[0]!.recording).toMatchObject({
        state: "preparing",
        primaryKind: null,
        secondaryKind: null,
        expectedBy: "2026-09-15",
      });
    });

    it("014 EARS-9.4: publishing a recording moves the same row's badge from preparing to montage — one canonical resolver", async () => {
      const ended = await seedEvent("ended", iso(-4 * DAY), "С записью");
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      await seedRegistration(await userIdOf(email), ended.id);

      const before = await myEvents(cookie, "recordings");
      expect(before.data[0]!.recording).toMatchObject({ state: "preparing" });

      await seedPublishedRecording(ended.id, "edited");

      const after = await myEvents(cookie, "recordings");
      expect(after.data[0]!.recording).toMatchObject({
        state: "montage",
        primaryKind: "edited",
        secondaryKind: null,
      });
    });

    it("014 EARS-9.5: a hidden registration appears in NEITHER tab", async () => {
      const hidden = await seedEvent("hidden", iso(-10 * DAY), "Скрыт");
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      await seedRegistration(await userIdOf(email), hidden.id);

      const upcoming = await myEvents(cookie, "upcoming");
      const recordings = await myEvents(cookie, "recordings");
      expect(upcoming.data).toEqual([]);
      expect(recordings.data).toEqual([]);
      expect(upcoming.counts).toEqual({ upcoming: 0, recordings: 0 });
    });

    it("014 EARS-9.6: counts cover BOTH tabs on either request, so the tab bar labels its inactive side", async () => {
      const soon = await seedEvent("published", iso(1 * DAY), "Завтра");
      const airing = await seedEvent("live", iso(-10 * 60 * 1000), "Сейчас");
      const past1 = await seedEvent("ended", iso(-2 * DAY), "Прошёл 1");
      const past2 = await seedEvent("ended", iso(-20 * DAY), "Прошёл 2");
      const hidden = await seedEvent("hidden", iso(-30 * DAY), "Скрытый");

      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const userId = await userIdOf(email);
      for (const ev of [soon, airing, past1, past2, hidden])
        await seedRegistration(userId, ev.id);

      const expected = { upcoming: 2, recordings: 2 };
      expect((await myEvents(cookie, "upcoming")).counts).toEqual(expected);
      expect((await myEvents(cookie, "recordings")).counts).toEqual(expected);
    });

    it("014 EARS-9.7: an unknown ?tab= is rejected (400) rather than silently served as the default", async () => {
      const email = uniqueEmail("doc");
      const cookie = await doctorSession(email);
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/events?tab=certificates",
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("014 EARS-9 / EARS-10: each tab returns only the caller's own registrations", async () => {
      const mine = await seedEvent("ended", iso(-2 * DAY), "Мой прошедший");
      const theirs = await seedEvent("ended", iso(-2 * DAY), "Чужой прошедший");

      const meEmail = uniqueEmail("me");
      const otherEmail = uniqueEmail("other");
      const meCookie = await doctorSession(meEmail);
      await doctorSession(otherEmail);
      await seedRegistration(await userIdOf(meEmail), mine.id);
      await seedRegistration(await userIdOf(otherEmail), theirs.id);

      const result = await myEvents(meCookie, "recordings");
      expect(result.data.map((e) => e.eventId)).toEqual([mine.id]);
    });
  },
);
