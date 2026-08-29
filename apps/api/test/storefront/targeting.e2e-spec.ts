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
  TARGETING_GENERAL_FALLBACK_STATEMENT_RU,
  TargetingSetSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { TargetingService } from "../../src/storefront/targeting.service.js";

// 017 EARS-8 (#1484) — the storefront resolver over the REAL managed relation
// rows in Postgres. The fixture deliberately includes tempting names, retired
// rows and reverse-only edges: none may become targeting without the exact
// active, directed row chain specialty → own direction → adjacent direction.
describe.skipIf(!process.env.DATABASE_URL)(
  "017 EARS-8 storefront targeting resolver (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let targeting: TargetingService;
    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];

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
      targeting = app.get(TargetingService);
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

    it("EARS-8: resolves targeting only through active managed directed rows and returns the honest «Другое» fallback", async () => {
      const specialtyRows = await pool.query<{
        id: string;
        code: string;
        is_other: boolean;
      }>(
        "SELECT id, code, is_other FROM specialties_minzdrav ORDER BY is_other, code",
      );
      const ordinary = specialtyRows.rows.filter((row) => !row.is_other);
      const primary = ordinary[0]!;
      const noLink = ordinary[1]!;
      const unrelatedSpecialty = ordinary[2]!;
      const other = specialtyRows.rows.find((row) => row.is_other)!;

      const makeDirection = async (label: string) => {
        const id = randomUUID();
        const slug = `targeting-${randomUUID()}`;
        await pool.query(
          "INSERT INTO directions (id, slug, title) VALUES ($1, $2, $3)",
          [id, slug, `${label} ${randomUUID().slice(0, 8)}`],
        );
        directionIds.push(id);
        return { id, slug };
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
        return id;
      };
      const makeEdge = async (input: {
        directionId: string;
        adjacentDirectionId: string;
        kind: "related" | "subdiscipline" | "interdisciplinary";
        weight: number;
        status?: "active" | "retired";
      }) => {
        const id = randomUUID();
        const status = input.status ?? "active";
        await pool.query(
          "INSERT INTO direction_adjacency (id, direction_id, adjacent_direction_id, kind, weight, status, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            id,
            input.directionId,
            input.adjacentDirectionId,
            input.kind,
            input.weight,
            status,
            status === "retired" ? new Date() : null,
          ],
        );
        edgeIds.push(id);
        return id;
      };

      const ownA = await makeDirection("Кардиология");
      const ownB = await makeDirection("Кардиология детская");
      const adjacentStrong = await makeDirection("Терапия");
      const adjacentTieA = await makeDirection("Реабилитация");
      const adjacentTieB = await makeDirection("Диагностика");
      const unrelatedSimilar = await makeDirection("Кардиология похожая");
      const reverseOnly = await makeDirection("Обратная связь");
      const retiredOwn = await makeDirection("Отозванное направление");
      const retiredAdjacent = await makeDirection("Отозванная смежность");

      await makeLink(ownA.id, primary.id);
      await makeLink(ownB.id, primary.id);
      await makeLink(retiredOwn.id, primary.id, "retired");
      await makeLink(unrelatedSimilar.id, unrelatedSpecialty.id);

      // The same adjacent target is reached twice: the stronger authored edge
      // wins deterministically and the direction is returned only once.
      await makeEdge({
        directionId: ownA.id,
        adjacentDirectionId: adjacentStrong.id,
        kind: "related",
        weight: 70,
      });
      await makeEdge({
        directionId: ownB.id,
        adjacentDirectionId: adjacentStrong.id,
        kind: "interdisciplinary",
        weight: 90,
      });
      const tieEdgeA = await makeEdge({
        directionId: ownA.id,
        adjacentDirectionId: adjacentTieA.id,
        kind: "subdiscipline",
        weight: 50,
      });
      const tieEdgeB = await makeEdge({
        directionId: ownB.id,
        adjacentDirectionId: adjacentTieB.id,
        kind: "related",
        weight: 50,
      });
      await makeEdge({
        directionId: ownA.id,
        adjacentDirectionId: ownB.id,
        kind: "related",
        weight: 100,
      });
      await makeEdge({
        directionId: reverseOnly.id,
        adjacentDirectionId: ownA.id,
        kind: "related",
        weight: 100,
      });
      await makeEdge({
        directionId: ownA.id,
        adjacentDirectionId: retiredAdjacent.id,
        kind: "related",
        weight: 100,
        status: "retired",
      });
      await makeEdge({
        directionId: retiredOwn.id,
        adjacentDirectionId: unrelatedSimilar.id,
        kind: "related",
        weight: 100,
      });

      const resolved = TargetingSetSchema.parse(
        await targeting.resolve(primary.id),
      );
      expect(resolved.primary.id).toBe(primary.id);
      expect(resolved.mode).toBe("targeted");
      expect(resolved.statement).toBeNull();
      expect(resolved.directions.map((row) => row.id)).toEqual(
        [ownA.id, ownB.id].sort(),
      );
      expect(resolved.directions.every((row) => row.role === "own")).toBe(true);

      const tieIds = [tieEdgeA, tieEdgeB].sort();
      const expectedTieDirections = tieIds.map((edgeId) =>
        edgeId === tieEdgeA ? adjacentTieA.id : adjacentTieB.id,
      );
      expect(resolved.adjacentDirections.map((row) => row.id)).toEqual([
        adjacentStrong.id,
        ...expectedTieDirections,
      ]);
      expect(resolved.adjacentDirections[0]).toMatchObject({
        role: "adjacent",
        kind: "interdisciplinary",
        weight: 90,
      });
      expect(
        resolved.adjacentDirections.every((row) => row.role === "adjacent"),
      ).toBe(true);
      expect(resolved.adjacentDirections.map((row) => row.id)).not.toContain(
        ownB.id,
      );
      expect(resolved.adjacentDirections.map((row) => row.id)).not.toContain(
        reverseOnly.id,
      );
      expect(resolved.adjacentDirections.map((row) => row.id)).not.toContain(
        retiredAdjacent.id,
      );
      expect(resolved.directions.map((row) => row.id)).not.toContain(
        retiredOwn.id,
      );
      expect(JSON.stringify(resolved)).not.toContain(unrelatedSimilar.id);

      // Similar names create no relationship: an ordinary no-link specialty is
      // a valid targeted selection whose managed sets are honestly empty.
      expect(await targeting.resolve(noLink.id)).toMatchObject({
        primary: { id: noLink.id, isOther: false },
        mode: "targeted",
        statement: null,
        directions: [],
        adjacentDirections: [],
      });

      // «Другое» is a remembered choice, but never an empty targeted set.
      expect(await targeting.resolve(other.id)).toEqual({
        primary: expect.objectContaining({ id: other.id, isOther: true }),
        mode: "general",
        statement: TARGETING_GENERAL_FALLBACK_STATEMENT_RU,
        directions: [],
        adjacentDirections: [],
      });
      expect(TARGETING_GENERAL_FALLBACK_STATEMENT_RU).toMatch(/[А-Яа-яЁё]/u);
    });
  },
);
