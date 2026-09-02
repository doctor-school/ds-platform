import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DoctorEventsFeedSchema,
  DoctorEventsMonthGridSchema,
  addDoctorEventsFeedDays,
  doctorEventsFeedDayOf,
  doctorEventsMonthDayList,
  doctorEventsMonthNextFirstDay,
  doctorEventsMonthOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";

/**
 * 019 EARS-4 (#1519) — `GET /v1/storefront/doctor/events/month`, the `MonthGrid`
 * navigation projection, over REAL rows.
 *
 * The load-bearing property is not "the endpoint answers": it is that the grid
 * and the day feed beside it are the SAME read. So the suite reads BOTH routes
 * with the same cookie and the same facets and asserts the counts agree, rather
 * than asserting the month against literals a mapper change would silently
 * invalidate.
 *
 * The fixture deliberately places one event in a direction the specialty cannot
 * reach through any managed row: a count that included it would mean a second,
 * looser selection path had appeared behind the grid.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "019 EARS-4 doctor events month grid (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];
    const eventIds: string[] = [];
    const eventDirectionIds: string[] = [];

    let targetedCode = "";
    let lonelyCode = "";

    let today = "";
    let month = "";
    /**
     * The month the fixture events live in — the current one when it still has
     * two days left after today, otherwise the next one. Assuming «today + 1»
     * and «today + 2» stay inside the current month would make the suite fail on
     * the 30th of every month, which is exactly the kind of red a calendar
     * feature must not manufacture.
     */
    let fixtureMonth = "";
    let liveDay = "";
    let plainDay = "";

    let liveEventId = "";
    let plainEventId = "";
    let unreachableEventId = "";

    const makeDirection = async (title: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `month-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
      );
      directionIds.push(id);
      return id;
    };

    const linkSpecialty = async (directionId: string, specialtyId: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status) VALUES ($1, $2, $3, 'active')",
        [id, directionId, specialtyId],
      );
      linkIds.push(id);
    };

    const makeEdge = async (from: string, to: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_adjacency (id, direction_id, adjacent_direction_id, kind, weight, status) VALUES ($1, $2, $3, 'related', 10, 'active')",
        [id, from, to],
      );
      edgeIds.push(id);
    };

    const makeEvent = async (input: {
      title: string;
      day: string;
      hour: number;
      directionId: string;
      state?: "published" | "live";
    }) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO events (id, slug, title, school, starts_at, duration_min, state) VALUES ($1, $2, $3, $4, $5, 60, $6)",
        [
          id,
          `month-${randomUUID()}`,
          input.title,
          "Школа 019",
          new Date(
            `${input.day}T${String(input.hour).padStart(2, "0")}:00:00+03:00`,
          ).toISOString(),
          input.state ?? "published",
        ],
      );
      eventIds.push(id);

      const linkId = randomUUID();
      await pool.query(
        "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
        [linkId, id, input.directionId],
      );
      eventDirectionIds.push(linkId);
      return id;
    };

    const readMonth = async (input: {
      specialtyCode?: string;
      query?: string;
    }) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events/month${input.query ?? ""}`,
        headers:
          input.specialtyCode === undefined
            ? {}
            : {
                cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(input.specialtyCode)}`,
              },
      });
      expect(response.statusCode).toBe(200);
      // `.strict()` on the SSOT: a ranking or personalisation field fails HERE.
      return DoctorEventsMonthGridSchema.parse(response.json());
    };

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      today = doctorEventsFeedDayOf(new Date());
      month = doctorEventsMonthOf(today);

      const lastDayOfMonth = addDoctorEventsFeedDays(
        doctorEventsMonthNextFirstDay(month),
        -1,
      );
      if (addDoctorEventsFeedDays(today, 2) <= lastDayOfMonth) {
        fixtureMonth = month;
        liveDay = addDoctorEventsFeedDays(today, 1);
        plainDay = addDoctorEventsFeedDays(today, 2);
      } else {
        fixtureMonth = doctorEventsMonthOf(
          doctorEventsMonthNextFirstDay(month),
        );
        liveDay = `${fixtureMonth}-02`;
        plainDay = `${fixtureMonth}-03`;
      }

      const specialties = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 2",
      );
      const [targeted, lonely] = specialties.rows;
      targetedCode = targeted!.code;
      lonelyCode = lonely!.code;

      const own = await makeDirection("Кардиология");
      const adjacent = await makeDirection("Функциональная диагностика");
      const unreachable = await makeDirection("Кардиология");
      const lonelyDirection = await makeDirection("Изолированное направление");

      await linkSpecialty(own, targeted!.id);
      await linkSpecialty(lonelyDirection, lonely!.id);
      await makeEdge(own, adjacent);

      liveEventId = await makeEvent({
        title: "Идёт сейчас",
        day: liveDay,
        hour: 10,
        directionId: own,
        state: "live",
      });
      plainEventId = await makeEvent({
        title: "Смежное направление",
        day: plainDay,
        hour: 12,
        directionId: adjacent,
      });
      unreachableEventId = await makeEvent({
        title: "Похожее по названию, но не связанное",
        day: plainDay,
        hour: 14,
        directionId: unreachable,
      });
    }, 60_000);

    afterAll(async () => {
      for (const id of eventDirectionIds) {
        await pool.query("DELETE FROM event_directions WHERE id = $1", [id]);
      }
      for (const id of eventIds) {
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of edgeIds) {
        await pool.query("DELETE FROM direction_adjacency WHERE id = $1", [id]);
      }
      for (const id of linkIds) {
        await pool.query("DELETE FROM direction_specialties WHERE id = $1", [
          id,
        ]);
      }
      for (const id of directionIds) {
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
      await app?.close();
    });

    it("EARS-4.1: returns every day of the current МСК month with «Сегодня» named by the server", async () => {
      const grid = await readMonth({ specialtyCode: targetedCode });

      expect(grid.month).toBe(month);
      expect(grid.today).toBe(today);
      // The whole month, `count: 0` days included — the host fills nothing in.
      expect(grid.days.map((day) => day.date)).toEqual(
        doctorEventsMonthDayList(month),
      );
      expect(grid.today.startsWith(`${grid.month}-`)).toBe(true);
    });

    it("EARS-4.2: counts match the day feed's group sizes for the same facets", async () => {
      const grid = await readMonth({
        specialtyCode: targetedCode,
        query: `?month=${fixtureMonth}`,
      });

      const windowFrom = fixtureMonth === month ? today : `${fixtureMonth}-01`;
      const feedResponse = await app.inject({
        method: "GET",
        // The fixture month as the feed's horizon, so the two reads cover the
        // same window and any divergence is a real disagreement.
        url: `/v1/storefront/doctor/events?from=${windowFrom}&to=${doctorEventsMonthNextFirstDay(fixtureMonth)}`,
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(targetedCode)}`,
        },
      });
      const feed = DoctorEventsFeedSchema.parse(feedResponse.json());

      const cells = new Map(grid.days.map((day) => [day.date, day.count]));
      for (const group of feed.days) {
        expect(cells.get(group.day)).toBe(group.items.length);
      }
      // And nothing the feed does not carry: the grid's total over the feed's
      // window equals the feed's own total.
      const inWindow = grid.days
        .filter((day) => day.date >= feed.from && day.date < feed.to)
        .reduce((sum, day) => sum + day.count, 0);
      expect(inWindow).toBe(feed.totalCount);
    });

    it("EARS-4.3: marks the live day and only the live day", async () => {
      const grid = await readMonth({
        specialtyCode: targetedCode,
        query: `?month=${fixtureMonth}`,
      });

      const live = grid.days.find((day) => day.date === liveDay);
      expect(live?.hasLive).toBe(true);
      expect(live?.count).toBeGreaterThan(0);

      for (const day of grid.days) {
        if (day.date !== liveDay) expect(day.hasLive).toBe(false);
      }
      expect(liveEventId).not.toBe("");
    });

    it("EARS-4.4: admits only managed own + adjacent directions — a shared name is not a relation", async () => {
      const grid = await readMonth({
        specialtyCode: targetedCode,
        query: `?month=${fixtureMonth}`,
      });
      expect(grid.targeting.mode).toBe("targeted");

      // `plainDay` holds the adjacent event AND the unreachable look-alike; only
      // the reachable one may be counted.
      const cell = grid.days.find((day) => day.date === plainDay);
      expect(cell?.count).toBe(1);
      expect(plainEventId).not.toBe(unreachableEventId);
    });

    it("EARS-4.5: keeps «пусто по специальности» distinct from «пусто по фасетам»", async () => {
      // Empty by SPECIALTY: the rare specialty reaches its own direction and no
      // adjacency rows — an honest targeted read with nothing in it.
      const bySpecialty = await readMonth({
        specialtyCode: lonelyCode,
        query: `?month=${fixtureMonth}`,
      });
      expect(bySpecialty.targeting.mode).toBe("targeted");
      expect(bySpecialty.targeting.adjacentDirectionIds).toEqual([]);
      expect(bySpecialty.days.every((day) => day.count === 0)).toBe(true);

      // Empty by FACETS: the same targeting that DOES carry events, narrowed by
      // a name search nothing matches. The two renders are told apart by
      // `targeting` plus the facets the caller applied, not by a bare zero.
      const byFacets = await readMonth({
        specialtyCode: targetedCode,
        query: `?month=${fixtureMonth}&q=${encodeURIComponent(randomUUID())}`,
      });
      expect(byFacets.targeting.mode).toBe("targeted");
      expect(byFacets.targeting.adjacentDirectionIds.length).toBeGreaterThan(0);
      expect(byFacets.days.every((day) => day.count === 0)).toBe(true);
    });

    it("EARS-4.6: serves a named month, and reads a past month as an empty upcoming-only grid", async () => {
      const past = "2020-02";
      const grid = await readMonth({
        specialtyCode: targetedCode,
        query: `?month=${past}`,
      });

      expect(grid.month).toBe(past);
      expect(grid.today).toBe(today);
      expect(grid.days).toHaveLength(29);
      expect(grid.days.every((day) => day.count === 0)).toBe(true);
    });

    it("EARS-4.7: refuses a malformed month with RFC 7807 Problem Details", async () => {
      for (const month of ["2026-13", "septembre", "2026-09-01"]) {
        const response = await app.inject({
          method: "GET",
          url: `/v1/storefront/doctor/events/month?month=${encodeURIComponent(month)}`,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it("EARS-4.8: is session-optional — an anonymous reader gets the untargeted grid", async () => {
      const anonymous = await readMonth({ query: `?month=${fixtureMonth}` });

      expect(anonymous.targeting.mode).toBe("all");
      expect(anonymous.targeting.specialtyReference).toBeNull();
      // Untargeted means WIDER, never gated: the look-alike direction that the
      // targeted read excludes is readable here.
      const cell = anonymous.days.find((day) => day.date === plainDay);
      expect(cell?.count ?? 0).toBeGreaterThanOrEqual(2);
    });
  },
);
