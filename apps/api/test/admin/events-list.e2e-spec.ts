import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { withSignInHost } from "../setup/storefront-harness.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// 007 EARS-14 (#4305) — the operator event list (GET /v1/admin/events) sorts
// by one column in either direction, filters by search (title / slug / school),
// lifecycle state and a Moscow-day start period, composes all of it with
// paging, and keeps the no-`sort` order alphabetical by title for the pickers
// that send none. Runs against the dev-stand Postgres + the fake IdP for the
// admin session; skips when those are absent so the shared CI unit job stays
// green (requirements Verification, row 14). It inserts its rows with SQL and
// never touches object storage, so it does not wait on `S3_ENDPOINT` — the CI
// `api-e2e` job, which sets no storage, runs it.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-14 admin event list: sort, filters, period (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let cookie: string;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const stamp = `e14-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminEmail = `admin-list-${stamp}@ds.test`;
    const schoolA = `Альфа-школа ${stamp}`;
    const schoolB = `Бета-школа ${stamp}`;

    /**
     * Five events, every slug carrying the stamp so `q=<stamp>` isolates them
     * from whatever else the shared dev database holds. The start instants
     * straddle the Moscow midnights of 2026-03-02 (= 2026-03-01T21:00Z) and
     * 2026-03-03 (= 2026-03-02T21:00Z), so a UTC-day reading of the period
     * would select a different pair than the Moscow-day one. The titles put a
     * lowercase «в» and a leading «Ё» in play: the Russian collation reads
     * А Б в Г Ё, a byte order would not.
     */
    const seed = [
      {
        n: 1,
        title: `Альфа ${stamp}`,
        school: schoolB,
        startsAt: "2026-03-01T20:59:00.000Z", // 2026-03-01 23:59 МСК
        state: "ended",
      },
      {
        n: 2,
        title: `Бета ${stamp}`,
        school: schoolA,
        startsAt: "2026-03-01T21:00:00.000Z", // 2026-03-02 00:00 МСК
        state: "published",
      },
      {
        n: 3,
        title: `вега ${stamp}`,
        school: schoolA,
        startsAt: "2026-03-02T20:59:59.000Z", // 2026-03-02 23:59:59 МСК
        state: "published",
      },
      {
        n: 4,
        title: `Гамма ${stamp}`,
        school: schoolB,
        startsAt: "2026-03-02T21:00:00.000Z", // 2026-03-03 00:00 МСК
        state: "draft",
      },
      {
        n: 5,
        title: `Ёлка ${stamp}`,
        school: schoolA,
        startsAt: "2026-02-10T09:00:00.000Z",
        state: "hidden",
      },
    ].map((e) => ({ ...e, id: randomUUID(), slug: `${stamp}-ev${e.n}` }));
    const idOf = (n: number): string => seed.find((e) => e.n === n)!.id;
    const ids = (...ns: number[]): string[] => ns.map(idOf);

    async function list(
      params: Record<string, string | number>,
    ): Promise<{ statusCode: number; ids: string[]; total: number }> {
      const search = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      );
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/events?${search.toString()}`,
        headers: { ...device, ...authHeaders(cookie) },
      });
      if (res.statusCode !== 200) {
        return { statusCode: res.statusCode, ids: [], total: 0 };
      }
      const body = res.json() as { data: { id: string }[]; total: number };
      return {
        statusCode: res.statusCode,
        ids: body.data.map((row) => row.id),
        total: body.total,
      };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: adminEmail, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [adminEmail],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      cookie = (
        await establishAdminSession(app, {
          identifier: adminEmail,
          password,
          device,
        })
      ).sid;

      for (const event of seed) {
        await pool.query(
          `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, state, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${eventClassificationSql()})`,
          [
            event.id,
            event.slug,
            event.title,
            event.school,
            event.startsAt,
            60,
            "Проверка сортировки и фильтров списка.",
            ["therapy"],
            event.state,
          ],
        );
      }
    });

    afterAll(async () => {
      if (pool) {
        for (const event of seed) await deleteEventFixture(pool, event.id);
        await deleteUserFixture(pool, "email", adminEmail);
      }
      await app?.close();
    });

    it("007 EARS-14: each sortable column orders both directions, desc the exact reverse of asc, stable across a page boundary", async () => {
      const ascending: Record<string, number[]> = {
        startsAt: [5, 1, 2, 3, 4],
        // Russian collation: case-insensitive, «Ё» beside «Е» — not before «А».
        title: [1, 2, 3, 4, 5],
        // Ties inside one school follow the start date in the same direction.
        school: [5, 2, 3, 1, 4],
        // Lifecycle order (draft → published → live → ended → hidden → in_archive).
        state: [4, 2, 3, 1, 5],
      };
      for (const [sort, order] of Object.entries(ascending)) {
        for (const dir of ["asc", "desc"] as const) {
          const expected = ids(
            ...(dir === "asc" ? order : [...order].reverse()),
          );
          const all = await list({ q: stamp, sort, dir, pageSize: 10 });
          expect(all, `${sort} ${dir}`).toEqual({
            statusCode: 200,
            ids: expected,
            total: 5,
          });
          // Page 2 of size 2 is exactly rows 3–4 of the whole order: no row is
          // repeated or skipped at the boundary.
          const page2 = await list({
            q: stamp,
            sort,
            dir,
            page: 2,
            pageSize: 2,
          });
          expect(page2, `${sort} ${dir} page 2`).toEqual({
            statusCode: 200,
            ids: expected.slice(2, 4),
            total: 5,
          });
        }
      }
      // `sort` without `dir` reads ascending.
      expect((await list({ q: stamp, sort: "startsAt" })).ids).toEqual(
        ids(5, 1, 2, 3, 4),
      );
    });

    it("007 EARS-14: a query without sort keeps the alphabetical title order the pickers rely on", async () => {
      const bare = await list({ q: stamp, pageSize: 10 });
      expect(bare).toEqual({
        statusCode: 200,
        ids: ids(1, 2, 3, 4, 5),
        total: 5,
      });
      expect(
        (await list({ q: stamp, sort: "title", dir: "asc", pageSize: 10 })).ids,
      ).toEqual(bare.ids);
    });

    it("007 EARS-14: search matches the title, the slug or the school", async () => {
      expect(await list({ q: `Гамма ${stamp}` })).toEqual({
        statusCode: 200,
        ids: ids(4),
        total: 1,
      });
      expect(await list({ q: `${stamp}-ev3` })).toEqual({
        statusCode: 200,
        ids: ids(3),
        total: 1,
      });
      // School search, case-insensitive.
      expect(
        await list({ q: schoolB.toUpperCase(), sort: "startsAt" }),
      ).toEqual({
        statusCode: 200,
        ids: ids(1, 4),
        total: 2,
      });
    });

    it("007 EARS-14: the state filter keeps exactly one lifecycle state", async () => {
      expect(
        await list({ q: stamp, state: "published", sort: "startsAt" }),
      ).toEqual({ statusCode: 200, ids: ids(2, 3), total: 2 });
      expect(await list({ q: stamp, state: "hidden" })).toEqual({
        statusCode: 200,
        ids: ids(5),
        total: 1,
      });
      expect(await list({ q: stamp, state: "in_archive" })).toEqual({
        statusCode: 200,
        ids: [],
        total: 0,
      });
    });

    it("007 EARS-14: the period is inclusive Moscow calendar days over the start, not UTC days", async () => {
      // 2026-03-02 МСК = [2026-03-01T21:00Z, 2026-03-02T21:00Z): events 2 and 3,
      // not 1 (23:59 МСК the day before) and not 4 (00:00 МСК the day after,
      // though still 2026-03-02 in UTC).
      expect(
        await list({
          q: stamp,
          startsFrom: "2026-03-02",
          startsTo: "2026-03-02",
          sort: "startsAt",
        }),
      ).toEqual({ statusCode: 200, ids: ids(2, 3), total: 2 });
      expect(
        await list({ q: stamp, startsFrom: "2026-03-02", sort: "startsAt" }),
      ).toEqual({ statusCode: 200, ids: ids(2, 3, 4), total: 3 });
      expect(
        await list({ q: stamp, startsTo: "2026-03-01", sort: "startsAt" }),
      ).toEqual({ statusCode: 200, ids: ids(5, 1), total: 2 });
    });

    it("007 EARS-14: sort, search, state, period and paging compose, and total counts the filtered set", async () => {
      const filters = {
        q: schoolA,
        state: "published",
        startsFrom: "2026-03-02",
        startsTo: "2026-03-02",
        sort: "startsAt",
        dir: "desc",
        pageSize: 1,
      };
      expect(await list({ ...filters, page: 1 })).toEqual({
        statusCode: 200,
        ids: ids(3),
        total: 2,
      });
      expect(await list({ ...filters, page: 2 })).toEqual({
        statusCode: 200,
        ids: ids(2),
        total: 2,
      });
      expect(await list({ ...filters, page: 3 })).toEqual({
        statusCode: 200,
        ids: [],
        total: 2,
      });
    });

    it("007 EARS-14: an unknown parameter, sort key, direction, state or an inverted / malformed period is refused with 400", async () => {
      for (const bad of [
        { status: "draft" },
        { sort: "duration" },
        { sort: "title", dir: "up" },
        { state: "archived" },
        { startsFrom: "02.03.2026" },
        { startsFrom: "2026-03-03", startsTo: "2026-03-02" },
      ]) {
        expect((await list(bad)).statusCode, JSON.stringify(bad)).toBe(400);
      }
    });
  },
);
