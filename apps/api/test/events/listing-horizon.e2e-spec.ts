import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  addDoctorEventsFeedDays,
  DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
  doctorEventsFeedDayOf,
  PublicEventListingPageSchema,
  type UpcomingBroadcastCard,
} from "@ds/schemas";
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
import {
  eventClassificationSql,
  SEED_EVENT_KINDS,
} from "../setup/event-classification.js";

/**
 * Wave-2 entry gate §4.2 (PR 2.4) — the Academy listing read
 * `GET /v1/public/events?timeframe=…`:
 *
 * - D2: the horizon (`from`, `to`) of the one codec — the doctor feed's own
 *   bounded window, «Показать ещё» widening `to` in the URL; the cursor stays
 *   accepted for other callers and never combines with a horizon.
 * - D3: every card carries its 012 kind and its attendance format.
 * - A2: every card carries the colleagues' sign-up count — active participant
 *   registrations, the doctor card's count.
 *
 * Runs against the dev-stand Postgres + the fake IdP (the count needs real
 * registrations), and skips when either is absent.
 */
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "wave-2 §4.2 Academy listing — horizon, kind + format, sign-up count (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const DAY = 24 * 60 * 60_000;

    const createdEmails: string[] = [];
    const eventIds: string[] = [];
    const today = doctorEventsFeedDayOf(new Date());

    let near = { id: "", slug: "" };
    let far = { id: "", slug: "" };
    let pastNear = { id: "", slug: "" };
    let pastOld = { id: "", slug: "" };
    let hybrid = { id: "", slug: "" };

    const makeEvent = async (input: {
      offsetMs: number;
      format?: "online" | "offline" | "hybrid";
      state?: "published" | "ended";
    }): Promise<{ id: string; slug: string }> => {
      const id = randomUUID();
      const slug = `horizon-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, participation_format, kind_id, audience) VALUES ($1, $2, $3, $4, $5, $6, $8, $7, ${eventClassificationSql("experts")})`,
        [
          id,
          slug,
          "Горизонт ленты",
          "Школа ортобиологии",
          new Date(Date.now() + input.offsetMs).toISOString(),
          90,
          input.format ?? "online",
          input.state ?? "published",
        ],
      );
      eventIds.push(id);
      return { id, slug };
    };

    const register = async (slug: string): Promise<void> => {
      const email = `horizon-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie!.value}`,
        },
      });
      expect(res.statusCode).toBe(200);
    };

    const list = async (query: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events?${query}`,
      });
      return res;
    };

    const page = async (query: string) => {
      const res = await list(query);
      expect(res.statusCode).toBe(200);
      return PublicEventListingPageSchema.parse(res.json());
    };

    const cardOf = (
      data: readonly UpcomingBroadcastCard[],
      id: string,
    ): UpcomingBroadcastCard | undefined => data.find((c) => c.id === id);

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

      near = await makeEvent({ offsetMs: 2 * DAY });
      hybrid = await makeEvent({ offsetMs: 3 * DAY, format: "hybrid" });
      far = await makeEvent({ offsetMs: 20 * DAY });
      pastNear = await makeEvent({ offsetMs: -3 * DAY, state: "ended" });
      // Thirty days back: past the 14-day default, so only a BACKWARD widening
      // of «Прошедшие» reaches it.
      pastOld = await makeEvent({ offsetMs: -30 * DAY, state: "ended" });

      await register(near.slug);
      await register(near.slug);
    }, 120_000);

    afterAll(async () => {
      for (const id of eventIds) await deleteEventFixture(pool, id);
      for (const email of createdEmails) {
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    it("NEW: the horizon bounds the read and echoes the applied window (D2)", async () => {
      const to = addDoctorEventsFeedDays(today, 14);
      const body = await page(`timeframe=upcoming&from=${today}&to=${to}`);
      const ids = body.data.map((card) => card.id);
      expect(ids).toContain(near.id);
      expect(ids).toContain(hybrid.id);
      expect(ids).not.toContain(far.id);
      expect(body.horizon?.from).toBe(today);
      expect(body.horizon?.to).toBe(to);
      // A horizon page is not a cursor page.
      expect(body.pagination.nextCursor).toBeNull();
    });

    it("NEW: «Показать ещё» names the next `to`, and that widening reaches the next event (D2, 019 LD-2)", async () => {
      const to = addDoctorEventsFeedDays(today, 14);
      const first = await page(`timeframe=upcoming&from=${today}&to=${to}`);
      const nextTo = first.horizon?.nextTo;
      expect(nextTo).not.toBeNull();
      expect(nextTo! > to).toBe(true);
      expect(first.pagination.hasMore).toBe(true);

      const widened = await page(
        `timeframe=upcoming&from=${today}&to=${nextTo!}`,
      );
      expect(widened.data.map((card) => card.id)).toContain(far.id);
    });

    it("NEW: a hand-edited `to` past the widest horizon is clamped, and nothing more is offered", async () => {
      const body = await page(
        `timeframe=upcoming&from=${today}&to=${addDoctorEventsFeedDays(today, 5000)}`,
      );
      expect(body.horizon?.to).toBe(
        addDoctorEventsFeedDays(today, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
      );
      expect(body.horizon?.nextTo).toBeNull();
    });

    it("NEW: the cursor stays accepted, and never combines with a horizon", async () => {
      const cursorPage = await page("timeframe=upcoming&limit=1");
      expect(cursorPage.horizon).toBeUndefined();
      expect(
        (await list(`timeframe=upcoming&cursor=abc&to=${today}`)).statusCode,
      ).toBe(400);
      expect((await list("timeframe=upcoming&to=22.10.2026")).statusCode).toBe(
        400,
      );
    });

    it("NEW: every card carries its 012 kind and its attendance format (D3)", async () => {
      const body = await page(
        `timeframe=upcoming&from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`,
      );
      const online = cardOf(body.data, near.id);
      expect(online?.kind.id).toBe(SEED_EVENT_KINDS.vstrechaKluba.id);
      expect(online?.kind.slug).toBe(SEED_EVENT_KINDS.vstrechaKluba.slug);
      expect(online?.kind.title.length).toBeGreaterThan(0);
      expect(online?.format).toBe("online");
      expect(cardOf(body.data, hybrid.id)?.format).toBe("hybrid");
    });

    it("NEW: the Academy read returns the count of active registrations (A2)", async () => {
      const body = await page(
        `timeframe=upcoming&from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`,
      );
      expect(cardOf(body.data, near.id)?.signUpCount).toBe(2);
      expect(cardOf(body.data, hybrid.id)?.signUpCount).toBe(0);

      // The legacy bare read projects the same card.
      const legacy = await app.inject({
        method: "GET",
        url: "/v1/public/events",
      });
      const bare = (legacy.json() as UpcomingBroadcastCard[]).find(
        (c) => c.id === near.id,
      );
      expect(bare?.signUpCount).toBe(2);
      expect(bare?.format).toBe("online");
    });

    it("NEW: «Прошедшие» extends BACKWARD — `nextFrom` names an older bound and that widening reaches older events (rows 30, 32)", async () => {
      const first = await page(
        `timeframe=past&from=${addDoctorEventsFeedDays(today, -14)}`,
      );
      expect(first.horizon?.to).toBe(addDoctorEventsFeedDays(today, 1));
      const ids = first.data.map((card) => card.id);
      expect(ids).toContain(pastNear.id);
      expect(ids).not.toContain(pastOld.id);
      // The past extent never widens forward.
      expect(first.horizon?.nextTo).toBeNull();
      const nextFrom = first.horizon?.nextFrom;
      expect(nextFrom).not.toBeNull();
      expect(nextFrom! < first.horizon!.from).toBe(true);
      expect(first.pagination.hasMore).toBe(true);

      const widened = await page(
        `timeframe=past&from=${nextFrom!}&to=${first.horizon!.to}`,
      );
      expect(widened.data.length).toBeGreaterThan(first.data.length);

      // Walking `nextFrom` to its end reaches the −30 event and stops.
      let extent = widened;
      while (extent.horizon?.nextFrom) {
        extent = await page(
          `timeframe=past&from=${extent.horizon.nextFrom}&to=${first.horizon!.to}`,
        );
      }
      expect(extent.data.map((card) => card.id)).toContain(pastOld.id);
      expect(extent.horizon?.remaining).toBe(0);
      expect(extent.pagination.hasMore).toBe(false);
    });

    it("NEW: «Показать ещё» states the next batch and the remainder — `remaining` is the events the widest horizon would add", async () => {
      const upcoming = await page(
        `timeframe=upcoming&from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`,
      );
      const upcomingAll = await page(
        `timeframe=upcoming&from=${today}&to=${addDoctorEventsFeedDays(today, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS)}`,
      );
      // `far` (+20) lies beyond the window, so the remainder is at least one.
      expect(upcoming.horizon?.remaining).toBeGreaterThanOrEqual(1);
      expect(upcoming.horizon?.remaining).toBe(
        upcomingAll.data.length - upcoming.data.length,
      );
      expect(upcoming.horizon?.nextFrom).toBeNull();
      expect(upcomingAll.horizon?.remaining).toBe(0);

      const pastTo = addDoctorEventsFeedDays(today, 1);
      const past = await page(
        `timeframe=past&from=${addDoctorEventsFeedDays(today, -14)}&to=${pastTo}`,
      );
      const pastAll = await page(
        `timeframe=past&from=${addDoctorEventsFeedDays(pastTo, -DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS)}&to=${pastTo}`,
      );
      expect(past.horizon?.remaining).toBeGreaterThanOrEqual(1);
      expect(past.horizon?.remaining).toBe(
        pastAll.data.length - past.data.length,
      );
      expect(pastAll.horizon?.remaining).toBe(0);
    });
  },
);
