import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";

// 004 EARS-15 + EARS-16 — the public month-calendar read side. Two endpoints:
//   GET /v1/public/events?month=YYYY-MM      → MonthBroadcastEntry[]
//   GET /v1/public/events/month-counts?year  → MonthlyEventCount[12]
// The month read returns every publish-visible (published/live/ended) event
// whose start instant (МСК month boundaries) falls in the requested month —
// INCLUDING the month's already-past events (EARS-15); draft/archived never
// appear. The projection is the thin MonthBroadcastEntry allow-list (id, slug,
// title, school, startsAt, state) — no operator/commercial field, speakers, or
// PII (EARS-10). The counts endpoint returns exactly 12 rows for the year,
// counting only publish-visible events grouped by МСК month; months with no
// events carry count: 0 (EARS-16). Both endpoints are public (no auth header).
// A malformed month / year is a 400. Lifecycle transitions are feature 007 (seam
// → parent #549), so this spec SEEDS events directly in a target state at a FIXED
// far-future instant (year 2031) so assertions are deterministic and other
// tests' rows can never collide. Runs against dev-stand Postgres; skips when
// DATABASE_URL is absent so the shared CI unit job stays green (requirements
// Verification, rows 15 + 16).
describe.skipIf(!process.env.DATABASE_URL)(
  "004 EARS-15..16 public month-range read + per-month counts (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "published" | "live" | "ended" | "archived";

    interface SeedOptions {
      state: SeedState;
      /** The canonical UTC start instant (ISO-8601) — a FIXED value, not an offset. */
      startsAt: string;
      title?: string;
    }

    /**
     * Seed one event row (+ two ordered speakers) directly at a fixed lifecycle
     * state and start instant — the 004↔007 fixture seam: lifecycle transitions
     * do not exist yet (feature 007), so a month test seeds the state + instant
     * it needs.
     */
    async function seedEvent(
      opts: SeedOptions,
    ): Promise<{ id: string; slug: string; startsAt: string }> {
      const id = randomUUID();
      const slug = `month-${opts.state}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          opts.title ?? "Пластика ахиллова сухожилия",
          "Школа травматологии",
          opts.startsAt,
          90,
          "Разбор клинических случаев.",
          ["traumatology", "orthopedics"],
          "sponsor:acme-pharma",
          null,
          opts.state,
        ],
      );
      await pool.query(
        `INSERT INTO event_speakers (event_id, position, name, regalia)
         VALUES ($1,0,$2,$3), ($1,1,$4,$5)`,
        [
          id,
          "Анна Соколова",
          "Травматолог-ортопед, к.м.н.",
          "Михаил Верещагин",
          "Хирург, профессор",
        ],
      );
      createdEventIds.push(id);
      return { id, slug, startsAt: opts.startsAt };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0))
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
    });

    afterAll(async () => {
      await app.close();
    });

    // ── EARS-15 — the month-range read ─────────────────────────────────────────

    it("EARS-15: returns published/live/ended events of the month incl. an already-past ended event, ordered nearest first", async () => {
      // All in July 2031 (МСК). The `ended` event is already in the past relative
      // to the others but still belongs to the month — it MUST be included.
      const ended = await seedEvent({
        state: "ended",
        startsAt: "2031-07-03T09:00:00.000Z",
        title: "Прошедший в этом месяце",
      });
      const published = await seedEvent({
        state: "published",
        startsAt: "2031-07-15T09:00:00.000Z",
        title: "Опубликованный",
      });
      const live = await seedEvent({
        state: "live",
        startsAt: "2031-07-20T09:00:00.000Z",
        title: "В эфире",
      });
      // Excluded by state — draft/archived have no month projection.
      await seedEvent({ state: "draft", startsAt: "2031-07-10T09:00:00.000Z" });
      await seedEvent({
        state: "archived",
        startsAt: "2031-07-25T09:00:00.000Z",
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events?month=2031-07",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        id: string;
        state: string;
        startsAt: string;
      }[];
      // Exactly the three publish-visible July events, nearest air date first.
      expect(body.map((e) => e.id)).toEqual([ended.id, published.id, live.id]);
      // Ascending by startsAt across the page.
      const times = body.map((e) => new Date(e.startsAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      // No draft/archived ever appears.
      for (const e of body) {
        expect(["published", "live", "ended"]).toContain(e.state);
      }
    });

    it("EARS-15: an adjacent-month event is excluded (only the requested month)", async () => {
      const july = await seedEvent({
        state: "published",
        startsAt: "2031-07-15T09:00:00.000Z",
      });
      // June and August events must not leak into the July read.
      await seedEvent({
        state: "published",
        startsAt: "2031-06-30T09:00:00.000Z",
      });
      await seedEvent({
        state: "published",
        startsAt: "2031-08-01T09:00:00.000Z",
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events?month=2031-07",
      });
      const body = res.json() as { id: string }[];
      expect(body.map((e) => e.id)).toEqual([july.id]);
    });

    it("EARS-15: the МСК boundary — a UTC instant late on 31 July is August in МСК", async () => {
      // 2031-07-31T21:30:00Z = 2031-08-01T00:30 МСК → belongs to AUGUST.
      const boundary = await seedEvent({
        state: "published",
        startsAt: "2031-07-31T21:30:00.000Z",
        title: "На границе месяца",
      });

      const july = await app.inject({
        method: "GET",
        url: "/v1/public/events?month=2031-07",
      });
      const august = await app.inject({
        method: "GET",
        url: "/v1/public/events?month=2031-08",
      });
      const inJuly = (july.json() as { id: string }[]).map((e) => e.id);
      const inAugust = (august.json() as { id: string }[]).map((e) => e.id);
      expect(inJuly).not.toContain(boundary.id);
      expect(inAugust).toContain(boundary.id);
    });

    it("EARS-15: the entry projection is the exact thin allow-list — no PII/commercial/heavier field", async () => {
      const seeded = await seedEvent({
        state: "published",
        startsAt: "2031-07-15T09:00:00.000Z",
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events?month=2031-07",
      });
      const body = res.json() as Record<string, unknown>[];
      const entry = body.find((e) => e.id === seeded.id);
      expect(entry).toBeDefined();
      const found = entry as Record<string, unknown>;

      expect(Object.keys(found).sort()).toEqual(
        ["id", "school", "slug", "startsAt", "state", "title"].sort(),
      );
      for (const forbidden of [
        "partnerRef",
        "partners",
        "programPdfRef",
        "programPdfUrl",
        "description",
        "durationMin",
        "speakers",
        "specialties",
        "createdAt",
        "updatedAt",
      ]) {
        expect(found).not.toHaveProperty(forbidden);
      }
    });

    it("EARS-15: an empty month is a valid 200 []; no auth header needed", async () => {
      // Nothing seeded in this far month.
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events?month=2031-02",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("EARS-15: a malformed month is a 400", async () => {
      for (const bad of ["2031-13", "2031-00", "2031-7", "nope"]) {
        const res = await app.inject({
          method: "GET",
          url: `/v1/public/events?month=${bad}`,
        });
        expect(res.statusCode).toBe(400);
      }
    });

    // ── EARS-16 — the per-month counts ─────────────────────────────────────────

    it("EARS-16: returns exactly 12 rows for the year, zero-months present, only publish-visible counted", async () => {
      // July: 2 publish-visible + 1 draft (excluded). September: 1 ended.
      await seedEvent({
        state: "published",
        startsAt: "2031-07-15T09:00:00.000Z",
      });
      await seedEvent({ state: "live", startsAt: "2031-07-20T09:00:00.000Z" });
      await seedEvent({ state: "draft", startsAt: "2031-07-10T09:00:00.000Z" });
      await seedEvent({
        state: "archived",
        startsAt: "2031-07-11T09:00:00.000Z",
      });
      await seedEvent({ state: "ended", startsAt: "2031-09-05T09:00:00.000Z" });

      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events/month-counts?year=2031",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { month: number; count: number }[];
      // Exactly 12 dense rows, months 1..12 in order.
      expect(body).toHaveLength(12);
      expect(body.map((r) => r.month)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      const byMonth = new Map(body.map((r) => [r.month, r.count]));
      // July counts only the 2 publish-visible events (draft + archived excluded).
      expect(byMonth.get(7)).toBe(2);
      // September counts the 1 ended event.
      expect(byMonth.get(9)).toBe(1);
      // A month with no events is present with count 0.
      expect(byMonth.get(2)).toBe(0);
    });

    it("EARS-16: the МСК boundary is consistent with the month read (late-31-July counts in August)", async () => {
      // Same boundary instant as the EARS-15 boundary case → August in МСК.
      await seedEvent({
        state: "published",
        startsAt: "2031-07-31T21:30:00.000Z",
      });
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events/month-counts?year=2031",
      });
      const body = res.json() as { month: number; count: number }[];
      const byMonth = new Map(body.map((r) => [r.month, r.count]));
      expect(byMonth.get(7)).toBe(0);
      expect(byMonth.get(8)).toBe(1);
    });

    it("EARS-16: a missing or malformed year is a 400", async () => {
      for (const url of [
        "/v1/public/events/month-counts",
        "/v1/public/events/month-counts?year=31",
        "/v1/public/events/month-counts?year=2031-01",
        "/v1/public/events/month-counts?year=abcd",
      ]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode).toBe(400);
      }
    });
  },
);
