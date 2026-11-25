import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { PublicExpertCountSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";

/**
 * 029 EARS-4 (#4242) — `GET /v1/public/experts/count` (V-1): the number of
 * `published` experts of the 012 registry, computed per request, no auth.
 *
 * Lifecycle states are written as the 012 lifecycle defines them (publish:
 * `published` + `first_published_at`; retire: `retired` + `deleted_at`;
 * restore: back to `draft`, `deleted_at` cleared), so the read is proven
 * against every state a row can be in. The suites run with
 * `fileParallelism: false`, so the count is asserted as the delta over a
 * baseline read taken at the start of the test.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "029 EARS-4 public expert count read (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const tag = randomUUID().slice(0, 8);
    const expertIds: string[] = [];

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterAll(async () => {
      if (pool) {
        await pool.query("DELETE FROM experts WHERE id = ANY($1)", [expertIds]);
      }
      await app?.close();
    });

    async function insertExpert(
      name: string,
      status: "draft" | "published" | "retired",
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts
           (slug, family_name, given_name, status, first_published_at, deleted_at)
         VALUES ($1, 'Счётова', $2, $3::taxonomy_status,
                 CASE WHEN $3::taxonomy_status <> 'draft' THEN now() END,
                 CASE WHEN $3::taxonomy_status = 'retired' THEN now() END)
         RETURNING id`,
        [`ec-${name}-${tag}`, name, status],
      );
      expertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function expertCount(): Promise<number> {
      // No cookie, no header: the read is public.
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/experts/count",
      });
      expect(res.statusCode, res.payload).toBe(200);
      const body = JSON.parse(res.payload) as unknown;
      expect(Object.keys(body as object)).toEqual(["count"]);
      return PublicExpertCountSchema.parse(body).count;
    }

    it("EARS-4: the public expert count shall count only published experts, change on publish and retire, and stay unchanged on a restore to draft until the expert is published again", async () => {
      const before = await expertCount();

      const draft = await insertExpert("draft", "draft");
      await insertExpert("retired", "retired");
      const published = await insertExpert("published", "published");
      expect(await expertCount()).toBe(before + 1);

      // Publishing a draft changes the very next answer.
      await pool.query(
        `UPDATE experts SET status = 'published', first_published_at = now()
          WHERE id = $1`,
        [draft],
      );
      expect(await expertCount()).toBe(before + 2);

      // Retiring a published expert changes the very next answer.
      await pool.query(
        `UPDATE experts SET status = 'retired', deleted_at = now() WHERE id = $1`,
        [published],
      );
      expect(await expertCount()).toBe(before + 1);

      // A restore returns the retired expert to `draft`: the answer holds.
      await pool.query(
        `UPDATE experts SET status = 'draft', deleted_at = NULL WHERE id = $1`,
        [published],
      );
      expect(await expertCount()).toBe(before + 1);

      // Published again, it counts again.
      await pool.query(
        `UPDATE experts SET status = 'published' WHERE id = $1`,
        [published],
      );
      expect(await expertCount()).toBe(before + 2);
    });
  },
);
