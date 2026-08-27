import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSpecialtyBookSeed } from "@ds/db";
import {
  normalizeSpecialtyQuery,
  SPECIALTY_OTHER_CODE,
  SpecialtyBookSchema,
  SpecialtySearchResultSchema,
  specialtyNameMatchesQuery,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";

// 017 EARS-5 (#1481) — the specialty search read: substring anywhere in the
// name, case- and «ё/е»-insensitive, over the WHOLE book rather than the
// frequent set (017-design §7, row «specialty search»).
//
// This file is the WIRE tier, over the real stack (Fastify + Postgres + the
// boot-time seed), mirroring `specialties.e2e-spec.ts`: it proves the served
// read applies the shared rule to the whole book. The matching RULE itself is
// proved database-free in the package that owns it,
// `packages/schemas/src/specialties/specialties.schema.spec.ts` — the only tier
// that can exercise both «ё/е» directions without depending on whether the
// seeded nomenclature order happens to contain a «ё».
//
// NO COUNT LITERAL APPEARS IN THIS FILE and no specialty name is hardcoded:
// every expectation is derived from `buildSpecialtyBookSeed()`, so a re-seed
// against an amended nomenclature order moves this suite by itself (EARS-3/4).


// Skips when the stand is absent, exactly as the 012 and EARS-3 suites do.
describe.skipIf(!process.env.DATABASE_URL)(
  "017 EARS-5 specialty search over the closed book (e2e)",
  () => {
    let app: NestFastifyApplication;
    const seed = buildSpecialtyBookSeed();

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
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    });

    async function search(query: string) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/specialties/search?q=${encodeURIComponent(query)}`,
      });
      expect(res.statusCode).toBe(200);
      return SpecialtySearchResultSchema.parse(res.json());
    }

    async function readBook() {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/specialties",
      });
      expect(res.statusCode).toBe(200);
      return SpecialtyBookSchema.parse(res.json());
    }

    it("017 EARS-5.5: narrows over the WHOLE book — every seeded entry is reachable by typing its own name", async () => {
      // The frequent set is a presentation shortcut, never the search corpus:
      // a non-frequent entry must be findable by typing it.
      const nonFrequent = seed.filter((row) => row.frequentRank === null);
      expect(nonFrequent.length).toBeGreaterThan(0);

      for (const row of nonFrequent.slice(0, 5)) {
        const result = await search(row.name);
        expect(result.entries.map((e) => e.code)).toContain(row.code);
      }
    });

    it("017 EARS-5.6: matches a fragment anywhere in the name, case-insensitively", async () => {
      // Derived from the seed, never a hardcoded specialty name: take a real
      // entry and type a slice out of its MIDDLE, upper-cased.
      const row = seed.find((r) => !r.isOther && r.name.length >= 10)!;
      const fragment = row.name.slice(3, 9);

      const result = await search(fragment.toUpperCase());
      expect(result.entries.map((e) => e.code)).toContain(row.code);
      // Every served row genuinely matches the shared rule — no fuzzy widening.
      for (const entry of result.entries) {
        expect(specialtyNameMatchesQuery(entry.name, fragment)).toBe(true);
      }
      // And the result is exactly the whole-book application of that rule.
      const book = await readBook();
      expect(new Set(result.entries.map((e) => e.code))).toEqual(
        new Set(
          book.entries
            .filter((e) => specialtyNameMatchesQuery(e.name, fragment))
            .map((e) => e.code),
        ),
      );
    });

    it("017 EARS-5.7: folds «ё» to «е» on the wire", async () => {
      const row = seed.find(
        (r) => !r.isOther && normalizeSpecialtyQuery(r.name).includes("е"),
      )!;
      const withYo = row.name.replace("е", "ё").replace("Е", "Ё");

      const result = await search(withYo);
      expect(result.entries.map((e) => e.code)).toContain(row.code);
    });

    it("017 EARS-5.8: a query that matches nothing serves an EMPTY result, not an error", async () => {
      const result = await search("щщщхъфывапролдж");

      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
      // The typed query comes back so the storefront can keep it editable and
      // discard a stale response — a no-match is a state, never a failure.
      expect(result.query).toBe("щщщхъфывапролдж");
    });

    it("017 EARS-5.9: keeps «Другое» reachable by typing", async () => {
      const other = seed.find((row) => row.isOther)!;
      const result = await search(other.name);

      expect(result.entries.map((e) => e.code)).toContain(SPECIALTY_OTHER_CODE);
      expect(result.entries.some((e) => e.isOther)).toBe(true);
    });

    it("017 EARS-5.10: an empty query serves the whole book, and `total` is what the read served", async () => {
      const result = await search("");
      const book = await readBook();

      expect(result.entries).toHaveLength(book.total);
      expect(result.total).toBe(result.entries.length);
      expect(new Set(result.entries.map((e) => e.code))).toEqual(
        new Set(book.entries.map((e) => e.code)),
      );
    });

    it("017 EARS-5.11: exposes no write path and refuses an over-long query", async () => {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const res = await app.inject({
          method,
          url: "/v1/public/specialties/search",
          payload: { q: "терапия" },
        });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
      }

      const res = await app.inject({
        method: "GET",
        url: `/v1/public/specialties/search?q=${"я".repeat(5000)}`,
      });
      // A pathological query is refused at the boundary rather than scanned.
      expect(res.statusCode).toBe(400);
    });
  },
);
