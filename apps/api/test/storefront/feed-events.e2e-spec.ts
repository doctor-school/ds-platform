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
  doctorEventsFeedDayOf,
  FEED_EVENTS_LIMIT,
  FeedEventsSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 018 EARS-4 (#1499) — `GET /v1/storefront/feed/{specialty}/events`, the
 * nearest-events block of the specialty feed (018-design §7).
 *
 * The block builds no events feed of its own: it is 019's targeted read
 * (`DoctorEventsService`) for the PATH specialty and its adjacency set, cut to
 * the nearest few, with 019's ONE card payload per item. The fixture uses a
 * specialty with no managed direction link of its own, so only the rows this
 * suite links can reach it.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "018 EARS-4 feed nearest events (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let code = "";
    let today = "";

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];
    const eventIds: string[] = [];

    let hiddenCountId = "";
    let shownCountId = "";
    let offlineAdjacentId = "";
    let fourthId = "";
    let unreachableId = "";

    const at = (dayOffset: number, hour: number) =>
      new Date(
        `${addDoctorEventsFeedDays(today, dayOffset)}T${String(hour).padStart(2, "0")}:00:00+03:00`,
      );

    const makeDirection = async (title: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `feed018-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
      );
      directionIds.push(id);
      return id;
    };

    const makeEvent = async (input: {
      title: string;
      startsAt: Date;
      directionId: string;
    }) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience) VALUES ($1, $2, $3, $4, $5, 60, 'published', ${eventClassificationSql("doctors")})`,
        [
          id,
          `feed018-${randomUUID()}`,
          input.title,
          "Школа 018",
          input.startsAt.toISOString(),
        ],
      );
      eventIds.push(id);
      await pool.query(
        "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
        [randomUUID(), id, input.directionId],
      );
      return id;
    };

    const read = async (specialty: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/storefront/feed/${encodeURIComponent(specialty)}/events`,
      });
      return response;
    };

    const readBlock = async () => {
      const response = await read(code);
      expect(response.statusCode).toBe(200);
      return {
        body: response.json() as Record<string, unknown>,
        block: FeedEventsSchema.parse(response.json()),
      };
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

      // A specialty no managed row reaches yet: only this suite's links do.
      const specialty = await pool.query<{ id: string; code: string }>(
        `SELECT s.id, s.code FROM specialties_minzdrav s
          WHERE s.is_other = false
            AND NOT EXISTS (SELECT 1 FROM direction_specialties ds WHERE ds.specialty_minzdrav_id = s.id)
          ORDER BY s.code DESC LIMIT 1`,
      );
      const row = specialty.rows[0]!;
      code = row.code;

      const own = await makeDirection("Направление 018");
      const adjacent = await makeDirection("Смежное 018");
      const unreachable = await makeDirection("Направление 018");
      const link = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status) VALUES ($1, $2, $3, 'active')",
        [link, own, row.id],
      );
      linkIds.push(link);
      const edge = randomUUID();
      await pool.query(
        "INSERT INTO direction_adjacency (id, direction_id, adjacent_direction_id, kind, weight, status) VALUES ($1, $2, $3, 'related', 10, 'active')",
        [edge, own, adjacent],
      );
      edgeIds.push(edge);

      // Seeded without the option: the column default hides the count.
      hiddenCountId = await makeEvent({
        title: "Ближайшее, счётчик скрыт",
        startsAt: at(1, 9),
        directionId: own,
      });
      shownCountId = await makeEvent({
        title: "Ближайшее, счётчик виден",
        startsAt: at(1, 18),
        directionId: own,
      });
      await pool.query(
        "UPDATE events SET hide_sign_up_count = false WHERE id = $1",
        [shownCountId],
      );
      offlineAdjacentId = await makeEvent({
        title: "Очная встреча коллег",
        startsAt: at(2, 12),
        directionId: adjacent,
      });
      await pool.query(
        "UPDATE events SET participation_format = 'offline' WHERE id = $1",
        [offlineAdjacentId],
      );
      fourthId = await makeEvent({
        title: "Четвёртое по счёту",
        startsAt: at(5, 12),
        directionId: own,
      });
      unreachableId = await makeEvent({
        title: "Похожее по названию",
        startsAt: at(1, 12),
        directionId: unreachable,
      });
    });

    afterAll(async () => {
      if (pool) {
        await pool.query(
          "DELETE FROM event_directions WHERE event_id = ANY($1::uuid[])",
          [eventIds],
        );
        await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [
          eventIds,
        ]);
        await pool.query(
          "DELETE FROM direction_adjacency WHERE id = ANY($1::uuid[])",
          [edgeIds],
        );
        await pool.query(
          "DELETE FROM direction_specialties WHERE id = ANY($1::uuid[])",
          [linkIds],
        );
        await pool.query("DELETE FROM directions WHERE id = ANY($1::uuid[])", [
          directionIds,
        ]);
      }
      await app?.close();
    });

    it("EARS-4: when a visitor opens the feed, system shall answer the nearest events of the specialty and its adjacent areas, soonest first, cut to the block's size — never an unlinked look-alike", async () => {
      const { block } = await readBlock();
      expect(block.items.map((item) => item.id)).toEqual([
        hiddenCountId,
        shownCountId,
        offlineAdjacentId,
      ]);
      expect(block.items).toHaveLength(FEED_EVENTS_LIMIT);
      const ids = block.items.map((item) => item.id);
      expect(ids).not.toContain(fourthId);
      expect(ids).not.toContain(unreachableId);
    });

    it("EARS-4: the sign-up counter is a number on every item except an event whose «Скрыть число записавшихся» option is on, whose item carries `signUpCount: null`", async () => {
      const { block } = await readBlock();
      const hidden = block.items.find((item) => item.id === hiddenCountId);
      const shown = block.items.find((item) => item.id === shownCountId);
      expect(hidden?.signUpCount).toBeNull();
      expect(typeof shown?.signUpCount).toBe("number");
    });

    it("EARS-4: an offline colleagues' meet-up is the `offline` format of the same event card payload, not a new item kind", async () => {
      const { block } = await readBlock();
      const meetUp = block.items.find((item) => item.id === offlineAdjacentId);
      expect(meetUp?.format).toBe("offline");
      const online = block.items.find((item) => item.id === shownCountId);
      expect(
        Object.keys(meetUp!)
          .filter((k) => k !== "city" && k !== "seatsLeft")
          .sort(),
      ).toEqual(
        Object.keys(online!)
          .filter((k) => k !== "city" && k !== "seatsLeft")
          .sort(),
      );
    });

    it("EARS-4: НМО is an attribute of each event only — the block carries no НМО heading, facet or filter, and links «Все события по специальности →» into 019's events feed", async () => {
      const { body, block } = await readBlock();
      expect(Object.keys(body).sort()).toEqual(["allEventsHref", "items"]);
      for (const item of block.items) expect(typeof item.nmo).toBe("boolean");
      expect(block.allEventsHref).toBe(
        `/events?specialty=${encodeURIComponent(code)}`,
      );
    });

    it("EARS-4: a path naming no member of the specialty book is an RFC 7807 not-found", async () => {
      const response = await read("no-such-specialty");
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
    });
  },
);
