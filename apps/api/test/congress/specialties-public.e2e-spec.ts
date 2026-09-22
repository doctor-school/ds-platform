import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SPECIALTY_OTHER_CODE, SpecialtyBookSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";

// 044 EARS-15 (#2308), V-9 — the congress site's specialties list.
//
// There is NO 044-owned route here on purpose: EARS-15 is satisfied by the
// public read the platform already serves, `GET /v1/public/specialties`
// (017 EARS-3, #1479). The congress site reaches that same read through its own
// same-origin nginx `/api` proxy, so what this suite proves is the property
// EARS-15 actually asserts about it — unauthenticated, cacheable, carrying the
// reserved «Другое» row, and served from the LIVE taxonomy rather than from a
// build-time snapshot.
//
// NO COUNT LITERAL APPEARS IN THIS FILE. The expected size of the list is read
// from `specialties_minzdrav` at test time: a snapshot frozen anywhere between
// the table and the response would drift from that count and fail EARS-15.3.
//
// Skips when the stand is absent, exactly as the 017 and 044 suites do.
describe.skipIf(!process.env.DATABASE_URL)(
  "044 EARS-15: the public specialties list serves the live taxonomy including «Другое», unauthenticated and cacheable",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

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
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    });

    /** The read exactly as the congress form makes it: no credential at all. */
    function readList() {
      return app.inject({ method: "GET", url: "/v1/public/specialties" });
    }

    it("EARS-15.1: serves the whole taxonomy to an unauthenticated caller, «Другое» included exactly once", async () => {
      const res = await readList();

      // Unauthenticated: no Authorization header, no session cookie, 200.
      expect(res.statusCode).toBe(200);
      const book = SpecialtyBookSchema.parse(res.json());

      // `total` is the read's own statement of the list size, and the congress
      // form binds to it — it must equal what was actually served.
      expect(book.entries.length).toBe(book.total);
      expect(book.total).toBeGreaterThan(0);

      // The reserved «other» row the form needs for a specialty outside the
      // nomenclature: present, flagged, and singular.
      const others = book.entries.filter((e) => e.isOther);
      expect(others).toHaveLength(1);
      expect(others[0]?.code).toBe(SPECIALTY_OTHER_CODE);
    });

    it("EARS-15.2: answers cacheable at the HTTP layer", async () => {
      const res = await readList();

      expect(res.headers["cache-control"]).toBe("public, max-age=300");
    });

    it("EARS-15.3: serves the live taxonomy — no snapshot stands between the table and the response", async () => {
      const res = await readList();
      const book = SpecialtyBookSchema.parse(res.json());

      const live = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM specialties_minzdrav",
      );

      expect(book.total).toBe(live.rows[0]?.n);
      expect(book.entries.length).toBe(live.rows[0]?.n);
    });
  },
);
