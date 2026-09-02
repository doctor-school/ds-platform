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
  addDoctorEventsFeedDays,
  DoctorEventsFeedSchema,
  doctorEventsFeedDayOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";

/**
 * 019 EARS-3 (#1518) — the day-grouped, specialty-targeted feed over REAL rows.
 *
 * The fixture is built to make an accidental likeness match visible: the
 * unreachable direction shares the targeted one's name prefix, and the
 * adjacency-less specialty's direction is named as a near-twin of the adjacent
 * one. Nothing may enter the feed except through an active, managed
 * `specialty → direction (→ adjacency) → event` row chain.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "019 EARS-3 doctor events feed (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];
    const eventIds: string[] = [];
    const eventDirectionIds: string[] = [];

    /** Specialty codes: one with adjacency, one deliberately without. */
    let adjacentCarryingCode = "";
    let lonelyCode = "";

    let today = "";
    let ownEventId = "";
    let secondOwnEventId = "";
    let adjacentEventId = "";
    let unreachableEventId = "";
    let farEventId = "";
    let lonelyEventId = "";

    const at = (dayOffset: number, hour: number) =>
      new Date(
        `${addDoctorEventsFeedDays(today, dayOffset)}T${String(hour).padStart(2, "0")}:00:00+03:00`,
      );

    const makeDirection = async (title: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `feed-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
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
      startsAt: Date;
      directionId: string;
    }) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO events (id, slug, title, school, starts_at, duration_min, state) VALUES ($1, $2, $3, $4, $5, 60, 'published')",
        [
          id,
          `feed-${randomUUID()}`,
          input.title,
          "Школа 019",
          input.startsAt.toISOString(),
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

    const readFeed = async (input: {
      specialtyCode: string;
      query?: string;
    }) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events${input.query ?? ""}`,
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(input.specialtyCode)}`,
        },
      });
      expect(response.statusCode).toBe(200);
      const body: unknown = response.json();
      // The envelope is validated against the SSOT on every read: the schema is
      // `.strict()`, so a stray ranking/personalisation field fails HERE.
      return DoctorEventsFeedSchema.parse(body);
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

      const specialties = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 2",
      );
      const [withAdjacency, lonely] = specialties.rows;
      adjacentCarryingCode = withAdjacency!.code;
      lonelyCode = lonely!.code;

      const own = await makeDirection("Кардиология");
      const adjacent = await makeDirection("Функциональная диагностика");
      // Shares the targeted direction's name prefix and is reachable from
      // nothing — a likeness-based resolver would pull it in.
      const unreachable = await makeDirection("Кардиология");
      const lonelyDirection = await makeDirection(
        "Функциональная диагностика смежная",
      );

      await linkSpecialty(own, withAdjacency!.id);
      await linkSpecialty(lonelyDirection, lonely!.id);
      await makeEdge(own, adjacent);

      ownEventId = await makeEvent({
        title: "Своё направление, утро",
        startsAt: at(1, 9),
        directionId: own,
      });
      secondOwnEventId = await makeEvent({
        title: "Своё направление, вечер",
        startsAt: at(1, 18),
        directionId: own,
      });
      adjacentEventId = await makeEvent({
        title: "Смежное направление",
        startsAt: at(3, 12),
        directionId: adjacent,
      });
      unreachableEventId = await makeEvent({
        title: "Похожее по названию, но не связанное",
        startsAt: at(2, 12),
        directionId: unreachable,
      });
      farEventId = await makeEvent({
        title: "За горизонтом по умолчанию",
        startsAt: at(20, 12),
        directionId: own,
      });
      lonelyEventId = await makeEvent({
        title: "Специальность без смежностей",
        startsAt: at(2, 15),
        directionId: lonelyDirection,
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

    it("EARS-3.1: groups the targeted events by day within the horizon and admits only managed own + adjacent directions", async () => {
      const feed = await readFeed({ specialtyCode: adjacentCarryingCode });

      expect(feed.targeting.mode).toBe("targeted");
      expect(feed.targeting.adjacentDirectionIds.length).toBeGreaterThan(0);
      expect(feed.from).toBe(today);

      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(ownEventId);
      expect(ids).toContain(secondOwnEventId);
      expect(ids).toContain(adjacentEventId);
      // No managed row reaches it — a shared name prefix is not a relation.
      expect(ids).not.toContain(unreachableEventId);
      expect(ids).not.toContain(lonelyEventId);
      // Outside the default bounded horizon.
      expect(ids).not.toContain(farEventId);

      const ownDay = addDoctorEventsFeedDays(today, 1);
      const group = feed.days.find((day) => day.day === ownDay);
      expect(group?.items.map((item) => item.id)).toEqual([
        ownEventId,
        secondOwnEventId,
      ]);
      expect(group?.label).toMatch(/\S/);

      // Day groups ascend and each day appears exactly once.
      const days = feed.days.map((day) => day.day);
      expect(days).toEqual([...days].sort());
      expect(new Set(days).size).toBe(days.length);
      // Every rendered event falls inside the declared horizon.
      for (const day of days) {
        expect(day >= feed.from && day < feed.to).toBe(true);
      }
    });

    it("EARS-3.2: a specialty with no adjacency rows yields no adjacent items", async () => {
      const feed = await readFeed({ specialtyCode: lonelyCode });

      expect(feed.targeting.adjacentDirectionIds).toEqual([]);
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toEqual([lonelyEventId]);
      // The near-twin name of the adjacent direction pulls nothing in.
      expect(ids).not.toContain(adjacentEventId);
      expect(ids).not.toContain(ownEventId);
    });

    it("EARS-3.3: the response carries no ranking, score or personalisation field", async () => {
      const feed = await readFeed({ specialtyCode: adjacentCarryingCode });

      const serialized = JSON.stringify(feed);
      for (const forbidden of [
        "score",
        "rank",
        "ranking",
        "relevance",
        "personal",
        "weight",
        "boost",
      ]) {
        expect(serialized.toLowerCase()).not.toContain(`"${forbidden}`);
      }
      const cardKeys = new Set(
        feed.days.flatMap((day) => day.items.flatMap((item) => Object.keys(item))),
      );
      expect([...cardKeys].some((key) => /score|rank|weight/i.test(key))).toBe(
        false,
      );
    });

    it("EARS-3.4: «показать ещё» extends the horizon named in the URL and only then reveals the later event", async () => {
      const first = await readFeed({ specialtyCode: adjacentCarryingCode });
      expect(first.nextTo).not.toBeNull();
      expect(first.nextTo! > first.to).toBe(true);

      const extended = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: `?from=${first.from}&to=${addDoctorEventsFeedDays(today, 30)}`,
      });
      expect(extended.to).toBe(addDoctorEventsFeedDays(today, 30));
      const ids = extended.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(ids).toContain(farEventId);
      expect(extended.totalCount).toBeGreaterThan(first.totalCount);
    });
  },
);
