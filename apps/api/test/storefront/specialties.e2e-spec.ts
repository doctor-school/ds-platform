import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSpecialtyBookSeed } from "@ds/db";
import {
  FrequentSpecialtiesSchema,
  isSpecialtyBookMember,
  SPECIALTY_OTHER_CODE,
  SpecialtyBookSchema,
  SpecialtyRefSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { SpecialtiesService } from "../../src/storefront/specialties.service.js";
import { SpecialtyError } from "../../src/storefront/specialties.errors.js";

// 017 EARS-3 (#1479) — the closed Минздрав specialty reference book and its
// public read, over the REAL stack: Fastify + Postgres + the boot-time seed.
//
// NO COUNT LITERAL APPEARS IN THIS FILE. The expected size of the book is
// `buildSpecialtyBookSeed().length` — derived from the provenance-stamped seed
// data — because 017-design §2 makes the row count a property of the seed and
// EARS-3/EARS-4 forbid any surface (a test assertion included) from carrying a
// hardcoded book size. A re-seed against an amended nomenclature order must move
// this suite's expectations by itself.
//
// Skips when the stand is absent, exactly as the 012 suites do.
describe.skipIf(!process.env.DATABASE_URL)(
  "017 EARS-3 closed Минздрав specialty reference book (e2e)",
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

    async function readBook() {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/specialties",
      });
      expect(res.statusCode).toBe(200);
      return SpecialtyBookSchema.parse(res.json());
    }

    it("EARS-3.1: serves the full seeded book with the entry total carried in the read", async () => {
      const book = await readBook();

      // The read serves every seeded entry — nomenclature rows plus «Другое».
      expect(book.entries).toHaveLength(seed.length);
      // `total` is the read's own statement of the book size; every count
      // surface binds to it, so it must equal what was actually served.
      expect(book.total).toBe(book.entries.length);
      expect(book.total).toBe(seed.length);

      // Exactly the seeded codes, no more and no fewer: an entry silently
      // dropped or an unseeded row silently added both fail here.
      expect(new Set(book.entries.map((e) => e.code))).toEqual(
        new Set(seed.map((row) => row.code)),
      );
      // Verbatim nomenclature wording — never normalized or abbreviated.
      const nameByCode = new Map(seed.map((row) => [row.code, row.name]));
      for (const entry of book.entries) {
        expect(entry.name).toBe(nameByCode.get(entry.code));
      }
    });

    it("EARS-3.2: includes «Другое» exactly once, flagged as the catch-all", async () => {
      const book = await readBook();
      const others = book.entries.filter((e) => e.isOther);

      expect(others).toHaveLength(1);
      expect(others[0]?.code).toBe(SPECIALTY_OTHER_CODE);
      // Every nomenclature entry is NOT the catch-all.
      expect(book.entries.filter((e) => !e.isOther)).toHaveLength(
        seed.filter((row) => !row.isOther).length,
      );
    });

    it("EARS-3.3: serves stable ids — a second read returns the same id for every code", async () => {
      const first = await readBook();
      const second = await readBook();

      const idByCode = new Map(first.entries.map((e) => [e.code, e.id]));
      for (const entry of second.entries) {
        expect(entry.id).toBe(idByCode.get(entry.code));
      }
      // Ids are canonical UUIDs and unique across the book.
      expect(new Set(first.entries.map((e) => e.id)).size).toBe(
        first.entries.length,
      );
    });

    it("EARS-3.4: serves the frequent set as an ordered subset of the same book", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/specialties/frequent",
      });
      expect(res.statusCode).toBe(200);
      const frequent = FrequentSpecialtiesSchema.parse(res.json());

      const expected = seed
        .filter((row) => row.frequentRank !== null)
        .sort((a, b) => (a.frequentRank ?? 0) - (b.frequentRank ?? 0));

      // The frequent set is a presentation ORDER over book rows, not a second
      // book: same codes, same sequence, every one of them a member.
      expect(frequent.entries.map((e) => e.code)).toEqual(
        expected.map((row) => row.code),
      );

      const book = await readBook();
      for (const entry of frequent.entries) {
        expect(isSpecialtyBookMember(entry.id, book.entries)).toBe(true);
      }
      // «Другое» is the fallback, never one of the specialties offered up front.
      expect(frequent.entries.some((e) => e.isOther)).toBe(false);
    });

    it("EARS-3.5: refuses a specialty reference that is not a member of the book", async () => {
      const specialties = app.get(SpecialtiesService);

      // The reusable membership mechanism every specialty-accepting path
      // consumes (#1481/#1482 choose-specialty included). This slice ships no
      // endpoint that takes a specialty reference, so the contract is asserted
      // where it is enforced: a non-member is refused, never coerced, never
      // created on the fly.
      await expect(
        specialties.resolveMember("00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(SpecialtyError);
      await expect(
        specialties.resolveMember("kardiologiya-narodnaya"),
      ).rejects.toBeInstanceOf(SpecialtyError);

      const refusal = await specialties
        .resolveMember("not-a-specialty")
        .then(() => null)
        .catch((error: unknown) => error as SpecialtyError);

      // RFC 7807 with the exact stable `errorCode` and a `traceId` (ADR-0002).
      expect(refusal?.errorCode).toBe("SPECIALTY_NOT_IN_BOOK");
      const problem = refusal!.toProblemDetails("trace-id-under-test");
      expect(problem.status).toBe(422);
      expect(problem.errorCode).toBe("SPECIALTY_NOT_IN_BOOK");
      expect(problem.traceId).toBe("trace-id-under-test");
      expect(problem.type).toContain("specialty-not-in-book");
      // The refusal names no database key and no internal state.
      expect(JSON.stringify(problem)).not.toContain("specialties_minzdrav");

      // A real member resolves.
      const book = await readBook();
      const member = book.entries[0]!;
      await expect(specialties.resolveMember(member.id)).resolves.toMatchObject({
        id: member.id,
        code: member.code,
      });
    });

    it("EARS-3.6: exposes no storefront write path to the book", async () => {
      const before = await readBook();

      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const res = await app.inject({
          method,
          url: "/v1/public/specialties",
          payload: { code: "novaya-specialnost", name: "Новая специальность" },
        });
        // The route simply does not exist for a mutating verb — no handler, no
        // "forbidden" oracle that would imply one could be authorized.
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
      }

      const after = await readBook();
      expect(after.total).toBe(before.total);
      expect(after.entries.map((e) => e.code)).toEqual(
        before.entries.map((e) => e.code),
      );
    });

    it("EARS-3.7: keeps specialties a distinct read model — no merged list, no shared label", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/specialties",
      });
      const body = res.json() as Record<string, unknown>;

      // The book read serves specialties and nothing else: no direction rows,
      // no school rows, no shared «направления» bucket smuggled alongside.
      expect(Object.keys(body).sort()).toEqual(["entries", "total"]);
      for (const entry of body.entries as unknown[]) {
        // Strict parse: an extra field — a direction id, a school ref, a merged
        // «kind» discriminator — fails here rather than reaching a surface.
        expect(() => SpecialtyRefSchema.parse(entry)).not.toThrow();
      }
    });
  },
);
