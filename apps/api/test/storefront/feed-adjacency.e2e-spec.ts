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
  AdjacentAreasSchema,
  SpecialtyFeedSchema,
  specialtyFeedPath,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";

/**
 * 018 EARS-8 (#1503) — `GET /v1/storefront/feed/{specialty}/adjacent`, the
 * adjacent-areas block of the specialty feed (018-design §7).
 *
 * The rows are authored the way 017's targeting e2e authors its managed links:
 * real `directions`, `direction_specialties` and `direction_adjacency` rows in
 * Postgres. The fixture includes a look-alike name with no managed row behind
 * it, a retired link, a retired edge, a draft adjacent direction, an adjacent
 * direction with no linked specialty, «Другое» and the chosen specialty itself
 * on the far side of an edge — none of which may become an entry.
 *
 * The specialties are book members no managed link reaches yet (picked at
 * random among those, so sibling suites picking deterministically do not
 * collide): only this suite's rows reach them.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "018 EARS-8 feed adjacent areas (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];

    type Spec = { id: string; code: string; name: string };
    let primary: Spec;
    let strong: Spec;
    let tieFirst: Spec;
    let tieSecond: Spec;
    let lookAlike: Spec;
    let retiredLinkTarget: Spec;
    let draftTarget: Spec;
    let lonely: Spec;
    let other: Spec;
    let strongWeakDirection = "";
    let strongStrongDirection = "";

    const makeDirection = async (
      title: string,
      status: "draft" | "published" = "published",
    ) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, $4, $5)",
        [
          id,
          `feed018-adj-${randomUUID()}`,
          `${title} ${randomUUID().slice(0, 8)}`,
          status,
          status === "draft" ? null : new Date(),
        ],
      );
      directionIds.push(id);
      return id;
    };
    const makeLink = async (
      directionId: string,
      specialtyId: string,
      status: "active" | "retired" = "active",
    ) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status, deleted_at) VALUES ($1, $2, $3, $4, $5)",
        [
          id,
          directionId,
          specialtyId,
          status,
          status === "retired" ? new Date() : null,
        ],
      );
      linkIds.push(id);
    };
    const makeEdge = async (
      directionId: string,
      adjacentDirectionId: string,
      weight: number,
      status: "active" | "retired" = "active",
    ) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_adjacency (id, direction_id, adjacent_direction_id, kind, weight, status, deleted_at) VALUES ($1, $2, $3, 'related', $4, $5, $6)",
        [
          id,
          directionId,
          adjacentDirectionId,
          weight,
          status,
          status === "retired" ? new Date() : null,
        ],
      );
      edgeIds.push(id);
    };

    const read = (specialty: string) =>
      app.inject({
        method: "GET",
        url: `/v1/storefront/feed/${encodeURIComponent(specialty)}/adjacent`,
      });
    const readAreas = async (specialty: string) => {
      const response = await read(specialty);
      expect(response.statusCode).toBe(200);
      return AdjacentAreasSchema.parse(response.json());
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

      const free = await pool.query<Spec>(
        `SELECT s.id, s.code, s.name FROM specialties_minzdrav s
          WHERE s.is_other = false
            AND NOT EXISTS (SELECT 1 FROM direction_specialties ds WHERE ds.specialty_minzdrav_id = s.id)
          ORDER BY random() LIMIT 8`,
      );
      expect(free.rows.length).toBe(8);
      [
        primary,
        strong,
        tieFirst,
        tieSecond,
        lookAlike,
        retiredLinkTarget,
        draftTarget,
        lonely,
      ] = free.rows as [Spec, Spec, Spec, Spec, Spec, Spec, Spec, Spec];
      // Title order is the database's, as the book read already sorts titles.
      [tieFirst, tieSecond] = (
        await pool.query<Spec>(
          "SELECT id, code, name FROM specialties_minzdrav WHERE id = ANY($1::uuid[]) ORDER BY name ASC",
          [[tieFirst.id, tieSecond.id]],
        )
      ).rows as [Spec, Spec];
      other = (
        await pool.query<Spec>(
          "SELECT id, code, name FROM specialties_minzdrav WHERE is_other = true",
        )
      ).rows[0]!;

      const own = await makeDirection("Своё направление 018");
      await makeLink(own, primary.id);

      // `strong` is reached through two adjacent directions: the heavier edge
      // (80) wins, and the entry appears once.
      strongWeakDirection = await makeDirection("Смежное слабое 018");
      strongStrongDirection = await makeDirection("Смежное сильное 018");
      await makeEdge(own, strongWeakDirection, 20);
      await makeEdge(own, strongStrongDirection, 80);
      await makeLink(strongWeakDirection, strong.id);
      await makeLink(strongStrongDirection, strong.id);

      // Two specialties on one 40-weight edge: ordered by title.
      const tieDirection = await makeDirection("Смежное равное 018");
      await makeEdge(own, tieDirection, 40);
      await makeLink(tieDirection, tieSecond.id);
      await makeLink(tieDirection, tieFirst.id);
      // «Другое» on the far side of an edge is never an entry.
      await makeLink(tieDirection, other.id);
      // Nor is the chosen specialty: a second direction of its own, reached by
      // the heaviest edge, stays an own direction and yields no entry.
      const ownSecond = await makeDirection("Своё второе направление 018");
      await makeLink(ownSecond, primary.id);
      await makeEdge(own, ownSecond, 100);

      // A retired link behind an active edge yields nothing.
      const retiredLinkDirection = await makeDirection("Отозванная связь 018");
      await makeEdge(own, retiredLinkDirection, 90);
      await makeLink(retiredLinkDirection, retiredLinkTarget.id, "retired");

      // A retired edge and a draft direction yield nothing.
      const retiredEdgeDirection = await makeDirection("Отозванное ребро 018");
      await makeEdge(own, retiredEdgeDirection, 95, "retired");
      await makeLink(retiredEdgeDirection, retiredLinkTarget.id);
      const draftDirection = await makeDirection("Черновое смежное 018", "draft");
      await makeEdge(own, draftDirection, 95);
      await makeLink(draftDirection, draftTarget.id);

      // An adjacent direction with no linked specialty yields no entry.
      const emptyDirection = await makeDirection("Пустое смежное 018");
      await makeEdge(own, emptyDirection, 99);

      // A direction titled like the chosen specialty, linked to `lookAlike`,
      // with no adjacency row from `own`: never an entry.
      const lookAlikeDirection = await makeDirection(primary.name);
      await makeLink(lookAlikeDirection, lookAlike.id);
    }, 60_000);

    afterAll(async () => {
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

    it("EARS-8: entries are the adjacent specialties resolved from managed rows, each linking into that specialty's own feed", async () => {
      const areas = await readAreas(primary.code);
      expect(areas.items.map((item) => item.specialty.id)).toEqual([
        strong.id,
        tieFirst.id,
        tieSecond.id,
      ]);
      for (const item of areas.items) {
        expect(item.feedHref).toBe(specialtyFeedPath(item.specialty.code));
        expect(item.specialty.isOther).toBe(false);
      }
    });

    it("EARS-8: a specialty reached through several adjacent directions appears once, through the heaviest edge", async () => {
      const areas = await readAreas(primary.code);
      const entries = areas.items.filter(
        (item) => item.specialty.id === strong.id,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]!.direction.id).toBe(strongStrongDirection);
      expect(JSON.stringify(areas)).not.toContain(strongWeakDirection);
    });

    it("EARS-8: never an entry — the chosen specialty, «Другое», a retired link, a retired edge, a draft direction", async () => {
      const ids = (await readAreas(primary.code)).items.map(
        (item) => item.specialty.id,
      );
      for (const refused of [
        primary.id,
        other.id,
        retiredLinkTarget.id,
        draftTarget.id,
      ]) {
        expect(ids).not.toContain(refused);
      }
    });

    it("EARS-8: a look-alike name with no managed row behind it is not an adjacent area", async () => {
      const areas = await readAreas(primary.code);
      expect(areas.items.map((item) => item.specialty.id)).not.toContain(
        lookAlike.id,
      );
      expect(
        areas.items.map((item) => item.direction.title),
      ).not.toContain(primary.name);
    });

    it("EARS-8: «Другое» and a specialty with no adjacency rows read an empty list", async () => {
      expect(await readAreas(other.code)).toEqual({ items: [] });
      expect(await readAreas(lonely.code)).toEqual({ items: [] });
    });

    it("EARS-8: a path naming no member of the book is 404 RFC 7807", async () => {
      const response = await read("ne-specialnost-018");
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.json()).toMatchObject({
        status: 404,
        errorCode: "SPECIALTY_FEED_NOT_FOUND",
      });
    });

    it("EARS-8: the envelope lists the adjacent block last, read through its own read", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/storefront/feed/${encodeURIComponent(primary.code)}`,
      });
      expect(response.statusCode).toBe(200);
      const feed = SpecialtyFeedSchema.parse(response.json());
      expect(feed.blocks.at(-1)).toEqual({
        kind: "adjacent",
        read: `/v1/storefront/feed/${encodeURIComponent(primary.code)}/adjacent`,
      });
    });
  },
);
