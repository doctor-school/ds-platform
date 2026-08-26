import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SCALE_STATISTICS_COUNTERS,
  ScaleStatisticsSchema,
  SpecialtyBookSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { StatisticsService } from "../../src/storefront/statistics.service.js";

// 017 EARS-2 / LD-3 (#1480) — the scale statistics over the REAL stack:
// Fastify + Postgres + the boot-warmed projection.
//
// NO COUNT LITERAL APPEARS IN THIS FILE. The specialties counter is asserted
// against `SpecialtyBook.total` served by the specialty read — the binding
// 017-design §7 requires of every count surface — not against a transcribed
// book size, so an amended nomenclature order moves this suite by itself.
//
// Skips when the stand is absent, exactly as the 012 and EARS-3 suites do.
describe.skipIf(!process.env.DATABASE_URL)(
  "017 EARS-2 scale statistics — one computed read (e2e)",
  () => {
    let app: NestFastifyApplication;

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
      // The boot warm-up is fire-and-forget; awaiting one refresh makes every
      // case below read a settled snapshot rather than race the timer.
      await app.get(StatisticsService).refresh();
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    });

    async function readStatistics() {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/statistics",
      });
      expect(res.statusCode).toBe(200);
      return { body: res.json() as Record<string, unknown>, res };
    }

    it("EARS-2.1: serves the scale counters from ONE public read carrying computedAt", async () => {
      const { body } = await readStatistics();
      const stats = ScaleStatisticsSchema.parse(body);

      // `computedAt` is REQUIRED — a consumer can always state how old the
      // figures are (LD-3's bounded staleness window).
      expect(typeof stats.computedAt).toBe("string");
      const computedAt = new Date(stats.computedAt);
      expect(Number.isNaN(computedAt.getTime())).toBe(false);
      // Computed, not typed: the instant is recent and not in the future.
      expect(computedAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);

      // Every key present is one of the four contract counters — the read
      // serves the hero's figures and nothing else.
      const keys = Object.keys(body).filter((key) => key !== "computedAt");
      for (const key of keys) {
        expect(SCALE_STATISTICS_COUNTERS).toContain(key);
      }
      // At least one real figure is served: an all-omitted response would mean
      // no source resolved at all, which is a broken stand, not a valid hero.
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(Number.isInteger(body[key])).toBe(true);
        expect(body[key] as number).toBeGreaterThanOrEqual(0);
      }

      // The public read requires no session — the same body for a guest.
      const guest = await app.inject({
        method: "GET",
        url: "/v1/public/statistics",
      });
      expect(guest.statusCode).toBe(200);
    });

    it("EARS-2.2: omits a counter with no source while its neighbours render", async () => {
      const { body } = await readStatistics();

      // `lessons` has no source on the platform today: there is no lesson
      // table. 017-design §6 (row «Hero + statistics») requires it OMITTED —
      // absent from the payload — never a zero standing in for a missing
      // source. A `0` here would tell a doctor there are no lessons; absence
      // says nothing, which is the honest statement.
      expect(Object.keys(body)).not.toContain("lessons");
      expect(body.lessons).toBeUndefined();
      // And no `null` placeholder either: the contract knows two states only.
      expect(JSON.stringify(body)).not.toContain("null");

      // The neighbours still render — the omission is per counter, never an
      // all-or-nothing failure of the block.
      expect(typeof body.specialties).toBe("number");
      expect(typeof body.doctors).toBe("number");
    });

    it("EARS-2.3: binds the specialties counter to the book total served by the specialty read", async () => {
      const { body } = await readStatistics();

      const bookRes = await app.inject({
        method: "GET",
        url: "/v1/public/specialties",
      });
      expect(bookRes.statusCode).toBe(200);
      const book = SpecialtyBookSchema.parse(bookRes.json());

      // The hero counter and the catalog's «Показать весь список — N» read the
      // SAME number: `SpecialtyBook.total`. No literal, no second count of the
      // table — the two surfaces cannot disagree.
      expect(body.specialties).toBe(book.total);
      expect(book.total).toBe(book.entries.length);
    });

    it("EARS-2.4: states no price, cart, subscription or financing anywhere in the response", async () => {
      const { body, res } = await readStatistics();

      // EARS-2: the interface never states who finances the doctor's learning,
      // and no 017 surface carries a rouble amount, cart, subscription or
      // payment affordance. The API cannot supply one even if a client asked.
      const payload = JSON.stringify(body).toLowerCase();
      for (const forbidden of [
        "₽",
        "руб",
        "rub",
        "price",
        "цена",
        "cart",
        "корзин",
        "subscription",
        "подписк",
        "sponsor",
        "спонсор",
        "payment",
        "оплат",
        "financing",
        "финанс",
        "tariff",
        "тариф",
      ]) {
        expect(payload).not.toContain(forbidden);
      }

      // Strict parse: an extra field — a plan id, a currency, a "typed by
      // operator" override — fails here rather than reaching a surface.
      expect(() => ScaleStatisticsSchema.parse(body)).not.toThrow();
      expect(res.headers["content-type"]).toContain("application/json");
    });

    it("EARS-2.5: serves already-computed figures — the read path counts no rows", async () => {
      const statistics = app.get(StatisticsService);

      // Two reads with no refresh between them return the SAME `computedAt`:
      // the request path serves a snapshot, it does not recompute (LD-3's «no
      // per-request row counting on the read path»).
      const first = ScaleStatisticsSchema.parse((await readStatistics()).body);
      const second = ScaleStatisticsSchema.parse((await readStatistics()).body);
      expect(second.computedAt).toBe(first.computedAt);
      for (const key of SCALE_STATISTICS_COUNTERS) {
        expect(second[key]).toBe(first[key]);
      }

      // An explicit refresh — the off-request-path mechanism — advances the
      // computed instant, so the staleness window is real and not frozen.
      await statistics.refresh();
      const refreshed = ScaleStatisticsSchema.parse(
        (await readStatistics()).body,
      );
      expect(new Date(refreshed.computedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(first.computedAt).getTime(),
      );
    });

    it("EARS-2.6: exposes no write path — a counter cannot be typed in", async () => {
      const before = ScaleStatisticsSchema.parse((await readStatistics()).body);

      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const res = await app.inject({
          method,
          url: "/v1/public/statistics",
          payload: { doctors: 100_000, lessons: 500 },
        });
        // No handler at all — not a 403 that would imply an operator with the
        // right role could set a scale figure by hand (LD-3).
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
      }

      const after = ScaleStatisticsSchema.parse((await readStatistics()).body);
      for (const key of SCALE_STATISTICS_COUNTERS) {
        expect(after[key]).toBe(before[key]);
      }
    });
  },
);
