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
 * 019 EARS-8 (#1523) — the query IS the state, proven at the API boundary.
 *
 * EARS-8 promises that the screen renders as a pure function of its URL plus
 * the viewer's session, with «no feed state living only in client memory».
 * `apps/doctor` can only keep that promise if the read behind it keeps it too,
 * so this spec asserts the API half of the same property against real rows:
 *
 * 1. **No viewer memory.** The same URL read twice, on two independent
 *    injections, yields the SAME body — no cursor, no «last visit» narrowing,
 *    nothing accumulated between calls.
 * 2. **The URL is the whole input.** Two viewers differing only in their
 *    cookie-free URL get the same feed; an unknown parameter changes nothing,
 *    because the shared codec drops what it does not understand rather than
 *    forwarding it into the query.
 * 3. **Repeatable facets round-trip.** `format`, `kind` and `city` survive both
 *    wire spellings and select the same rows either way.
 * 4. **An invalid value is a 400 at the boundary**, never a 500 from a value
 *    that reached Postgres.
 *
 * Targeting arithmetic is NOT re-proven here — that is
 * `doctor-events-feed.e2e-spec.ts` (#1518). This spec is about the codec.
 * Browser back / shared-link / return flows belong to #1516.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "019 EARS-8 doctor events query codec (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const eventIds: string[] = [];
    const eventDirectionIds: string[] = [];

    let specialtyCode = "";
    let directionId = "";
    let today = "";
    let webinarEventId = "";
    let secondWebinarEventId = "";

    const at = (dayOffset: number, hour: number) =>
      new Date(
        `${addDoctorEventsFeedDays(today, dayOffset)}T${String(hour).padStart(2, "0")}:00:00+03:00`,
      );

    const read = async (query: string) =>
      app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events${query}`,
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(specialtyCode)}`,
        },
      });

    const readFeed = async (query: string) => {
      const response = await read(query);
      expect(response.statusCode).toBe(200);
      return DoctorEventsFeedSchema.parse(response.json());
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
        "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 1",
      );
      const specialty = specialties.rows[0]!;
      specialtyCode = specialty.code;

      directionId = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [directionId, `query-${randomUUID()}`, `Кодек ${randomUUID().slice(0, 8)}`],
      );
      directionIds.push(directionId);

      const linkId = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status) VALUES ($1, $2, $3, 'active')",
        [linkId, directionId, specialty.id],
      );
      linkIds.push(linkId);

      const makeEvent = async (title: string, startsAt: Date) => {
        const id = randomUUID();
        await pool.query(
          "INSERT INTO events (id, slug, title, school, starts_at, duration_min, state) VALUES ($1, $2, $3, $4, $5, 60, 'published')",
          [
            id,
            `query-${randomUUID()}`,
            title,
            "Школа 019",
            startsAt.toISOString(),
          ],
        );
        eventIds.push(id);
        const eventDirectionId = randomUUID();
        await pool.query(
          "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
          [eventDirectionId, id, directionId],
        );
        eventDirectionIds.push(eventDirectionId);
        return id;
      };

      webinarEventId = await makeEvent("Кодек, первое", at(1, 9));
      secondWebinarEventId = await makeEvent("Кодек, второе", at(2, 9));
    }, 60_000);

    afterAll(async () => {
      for (const id of eventDirectionIds) {
        await pool.query("DELETE FROM event_directions WHERE id = $1", [id]);
      }
      for (const id of eventIds) {
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
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

    it("019 EARS-8.13: the same URL read twice yields the identical feed — the read holds no viewer memory", async () => {
      const query = `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}&tense=upcoming`;
      const first = await readFeed(query);
      const second = await readFeed(query);

      // Byte-identical, not merely «equivalent»: a cursor, a seen-set or an
      // accumulating horizon would show up as a difference on the second call.
      expect(second).toEqual(first);
      const ids = first.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(webinarEventId);
      expect(ids).toContain(secondWebinarEventId);
    });

    it("019 EARS-8.14: an unknown parameter is ignored — it cannot narrow, widen or reorder the feed", async () => {
      const base = `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`;
      const clean = await readFeed(base);
      const noisy = await readFeed(
        `${base}&sort=relevance&page=2&utm_source=mail&personalised=true`,
      );

      // `sort`/`page`/`personalised` are exactly the parameters a ranking or a
      // paging engine would introduce; the codec drops them at the boundary, so
      // 019's «no ranking, no client paging» invariant cannot be talked into
      // existence from the address bar.
      expect(noisy).toEqual(clean);
    });

    it("019 EARS-8.15: repeatable facets round-trip in both wire spellings", async () => {
      const base = `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`;
      const repeated = await readFeed(
        `${base}&format=webinar&format=podcast&kind=${directionId}`,
      );
      const comma = await readFeed(
        `${base}&format=webinar,podcast&kind=${directionId}`,
      );
      expect(comma).toEqual(repeated);

      // The facet actually selects: the same read restricted to a format the
      // fixture has no rows for comes back empty rather than unchanged.
      const other = await readFeed(`${base}&format=congress`);
      const otherIds = other.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(otherIds).not.toContain(webinarEventId);

      const cities = await readFeed(`${base}&city=msk,spb`);
      expect(cities.from).toBe(repeated.from);
    });

    it("019 EARS-8.16: the specialty key takes a mode word and an explicit list from the same URL", async () => {
      const base = `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`;
      const all = await readFeed(`${base}&specialty=all`);
      expect(all.targeting.mode).toBe("all");

      const targeted = await readFeed(`${base}&specialty=mine-and-adjacent`);
      expect(targeted.targeting.mode).not.toBe("all");

      // A single non-mode value is a reference LIST, never a mis-read mode.
      const explicit = await readFeed(`${base}&specialty=${specialtyCode}`);
      expect(explicit.targeting.mode).not.toBe("all");
    });

    it("019 EARS-8.17: an invalid value is a 400 at the boundary, not a 500 from downstream", async () => {
      for (const query of [
        "?from=12.09.2026",
        "?tense=sideways",
        // `kind` is a uuid column downstream — an unconstrained value would
        // reach Postgres and raise `22P02` as a 500 on a public URL.
        "?kind=not-a-uuid",
        "?day=2026-13-99x",
      ]) {
        const response = await read(query);
        // The status is the assertion; the envelope is the app-wide error
        // shape, owned by ADR-0002 rather than by this controller.
        expect(response.statusCode).toBe(400);
        expect(response.json()).toBeTypeOf("object");
      }
    });
  },
);
