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
  DoctorEventsFeedQuerySchema,
  doctorEventsFeedDayOf,
  PublicEventListingQuerySchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { EventsService } from "../../src/events/events.service.js";
import { DoctorEventsService } from "../../src/storefront/doctor-events.service.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";
import {
  eventClassificationSql,
  type TestEventAudience,
} from "../setup/event-classification.js";

/**
 * 004 EARS-9 (#3639) — only `ended` / `archived` drop a card from the listing;
 * a `live` эфир stays in «Будущие» while it runs, whatever МСК day it started
 * on. The «Будущие» horizon opens at today 00:00 МСК, so an эфир that went live
 * before Moscow midnight and still runs after it must be held by every window
 * that holds today — on both storefront reads of the one horizon codec — and
 * by no window that does not (a later `from`, the «Показать ещё» reach beyond).
 *
 * The clock is pinned through the services' injectable `now` (an HTTP read
 * cannot pin it): one hour after today's МСК midnight, with the live seed one
 * hour before it — inside the 6 h air window (004 EARS-7), across the day edge.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "004 EARS-9 a live эфир stays listed across Moscow midnight (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let events: EventsService;
    let doctorEvents: DoctorEventsService;
    const fake = new FakeIdpClient();
    const eventIds: string[] = [];

    const HOUR = 60 * 60_000;
    const today = doctorEventsFeedDayOf(new Date());
    const midnight = new Date(`${today}T00:00:00+03:00`);
    const now = new Date(midnight.getTime() + HOUR);
    const beforeMidnight = new Date(midnight.getTime() - HOUR);

    const seed = async (
      state: "live" | "ended" | "published",
      audience: TestEventAudience,
    ): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience) VALUES ($1, $2, $3, $4, $5, $6, $7, ${eventClassificationSql(audience)})`,
        [
          id,
          `midnight-${state}-${id.slice(0, 8)}`,
          "Эфир через полночь",
          "Школа ортобиологии",
          beforeMidnight.toISOString(),
          240,
          state,
        ],
      );
      eventIds.push(id);
      return id;
    };

    let academyLive = "";
    let academyEnded = "";
    let academyPublished = "";
    let doctorLive = "";
    let doctorEnded = "";
    let doctorPublished = "";

    const academy = (query: Record<string, string>) =>
      events.listPublicEvents(
        PublicEventListingQuerySchema.parse({
          timeframe: "upcoming",
          ...query,
        }),
        now,
      );

    const doctor = (query: Record<string, string>) =>
      doctorEvents.feed({
        query: DoctorEventsFeedQuerySchema.parse({
          tense: "upcoming",
          specialty: "all",
          ...query,
        }),
        specialtyReference: null,
        now,
      });

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      events = app.get(EventsService);
      doctorEvents = app.get(DoctorEventsService);

      academyLive = await seed("live", "experts");
      academyEnded = await seed("ended", "experts");
      academyPublished = await seed("published", "experts");
      doctorLive = await seed("live", "doctors");
      doctorEnded = await seed("ended", "doctors");
      doctorPublished = await seed("published", "doctors");
    });

    afterAll(async () => {
      for (const id of eventIds.splice(0)) await deleteEventFixture(pool, id);
      await app.close();
    });

    it("EARS-9: a live event that started before today's МСК midnight stays in the Academy «Будущие» with its live signal; an ended or merely published one from before midnight stays out", async () => {
      const page = await academy({});
      const live = page.data.filter((card) => card.id === academyLive);
      expect(live).toHaveLength(1);
      expect(live[0]?.state).toBe("live");
      expect(page.data.some((card) => card.id === academyEnded)).toBe(false);
      // Only `live` reaches back past the window's lower bound: a `published`
      // эфир that started before midnight is placed by its start like any other.
      expect(page.data.some((card) => card.id === academyPublished)).toBe(
        false,
      );

      // A stated window holding today holds it too.
      const stated = await academy({
        from: today,
        to: addDoctorEventsFeedDays(today, 7),
      });
      expect(stated.data.some((card) => card.id === academyLive)).toBe(true);
    });

    it("EARS-9: a window that does not hold today never lists the running эфир, and «Показать ещё» never counts it again", async () => {
      const later = await academy({
        from: addDoctorEventsFeedDays(today, 1),
        to: addDoctorEventsFeedDays(today, 30),
      });
      expect(later.data.some((card) => card.id === academyLive)).toBe(false);

      // The one-event extent shows it; what lies beyond is asked from `to`
      // on, so the running эфир is not part of the remainder.
      const first = await academy({ count: "1" });
      expect(first.data[0]?.id).toBe(academyLive);
      const all = await academy({ count: "1000" });
      const allLive = all.data.filter((card) => card.id === academyLive);
      expect(allLive).toHaveLength(1);
      expect(first.horizon?.remaining).toBe(
        all.data.length - first.data.length,
      );
    });

    it("EARS-9: the doctor feed «Будущие» keeps a live event that started before today's МСК midnight; an ended or merely published one stays out", async () => {
      const feed = await doctor({});
      const ids = feed.days.flatMap((day) => day.items.map((card) => card.id));
      expect(ids.filter((id) => id === doctorLive)).toHaveLength(1);
      expect(ids).not.toContain(doctorEnded);
      expect(ids).not.toContain(doctorPublished);

      const later = await doctor({
        from: addDoctorEventsFeedDays(today, 1),
        to: addDoctorEventsFeedDays(today, 30),
      });
      const laterIds = later.days.flatMap((day) =>
        day.items.map((card) => card.id),
      );
      expect(laterIds).not.toContain(doctorLive);
    });
  },
);
