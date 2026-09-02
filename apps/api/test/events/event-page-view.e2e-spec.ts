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
import { deleteEventFixture } from "../setup/fixture-cleanup.js";

// 020 EARS-1 (#1764) — ONE shared event-page core, read by BOTH storefronts.
//
// The defect this spec exists to prevent is two hosts that can disagree about
// the same event: an academy page and a doctor page fed by separate read models
// drift the moment one is edited. So the doctor route
// `GET /v1/storefront/doctor/events/:idOrSlug` delegates to feature 004's ONE
// `EventsService.publicEventPage`, and the property proved here is DEEP-EQUAL
// bodies across the two hosts — the storefront is the envelope (header, nav,
// route, copy defaults), never a field of the read.
//
// It also pins the two fields slice 1 widens `PublicEventPage` into
// `EventPageView` with (LD-1, design §4): `format` (online/offline/hybrid — the
// axis that decides whether seats exist to run out of) and `seatsLeft` (`null` =
// no seat limit, which is a different answer from `0`). The FormatBlock union
// and the `mode` URL codec are EARS-8 (#1771), deliberately not here.
//
// Event authoring / lifecycle transitions are feature 007's (fixture seam), so
// this spec seeds rows directly in the state it needs. Runs against the
// dev-stand Postgres; skips when DATABASE_URL is absent so the shared CI unit
// job stays green.
describe.skipIf(!process.env.DATABASE_URL)(
  "020 EARS-1 shared event-page core (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "published" | "live" | "ended" | "hidden";

    interface SeedOptions {
      state: SeedState;
      format?: "online" | "offline" | "hybrid";
      seatsLeft?: number | null;
    }

    /** Seed one event row (+ one speaker) in the target lifecycle state. */
    async function seedEvent(
      opts: SeedOptions,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `view-${opts.state}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, seats_left)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          slug,
          "Ведение пациентов с ХСН",
          "Кардиология сегодня",
          "2026-07-18T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          opts.state,
          opts.format ?? "online",
          opts.seatsLeft ?? null,
        ],
      );
      await pool.query(
        `INSERT INTO event_speakers (event_id, position, name, regalia)
         VALUES ($1,0,$2,$3)`,
        [id, "Анна Соколова", "Кардиолог, к.м.н."],
      );
      createdEventIds.push(id);
      return { id, slug };
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
        await deleteEventFixture(pool, id);
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(["published", "live", "ended"] as const)(
      "020 EARS-1: the Academy and doctor hosts return content-identical bodies for one %s event",
      async (state) => {
        const { id, slug } = await seedEvent({
          state,
          format: "hybrid",
          seatsLeft: 12,
        });

        const academy = await app.inject({
          method: "GET",
          url: `/v1/public/events/${slug}`,
        });
        const doctor = await app.inject({
          method: "GET",
          url: `/v1/storefront/doctor/events/${slug}`,
        });

        expect(academy.statusCode).toBe(200);
        expect(doctor.statusCode).toBe(200);
        // Deep-equal, not merely both-200: one read model means there is exactly
        // one body to return, and any storefront-local mapping would show up
        // here as a divergence.
        expect(doctor.json()).toEqual(academy.json());
        expect((doctor.json() as { id: string }).id).toBe(id);
      },
    );

    it.each(["published", "live", "ended"] as const)(
      "020 EARS-1: a %s event is reachable on BOTH hosts with no authentication",
      async (state) => {
        const { slug } = await seedEvent({ state });

        for (const url of [
          `/v1/public/events/${slug}`,
          `/v1/storefront/doctor/events/${slug}`,
        ]) {
          const res = await app.inject({ method: "GET", url });
          expect(res.statusCode).toBe(200);
          expect((res.json() as { state: string }).state).toBe(state);
        }
      },
    );

    it("020 EARS-1: a draft event is not found on BOTH hosts — the doctor route is no «exists but private» oracle", async () => {
      const { slug } = await seedEvent({ state: "draft" });

      for (const url of [
        `/v1/public/events/${slug}`,
        `/v1/storefront/doctor/events/${slug}`,
      ]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode).toBe(404);
      }
    });

    it("020 EARS-1: the doctor host resolves an event by id as well as by slug", async () => {
      const { id, slug } = await seedEvent({ state: "published" });

      const byId = await app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events/${id}`,
      });

      expect(byId.statusCode).toBe(200);
      expect((byId.json() as { slug: string }).slug).toBe(slug);
    });

    it("020 EARS-1: the widened read carries the participation format and the remaining seats on both hosts", async () => {
      const { slug } = await seedEvent({
        state: "published",
        format: "offline",
        seatsLeft: 5,
      });

      for (const url of [
        `/v1/public/events/${slug}`,
        `/v1/storefront/doctor/events/${slug}`,
      ]) {
        const body = (await app.inject({ method: "GET", url })).json() as {
          format: string;
          seatsLeft: number | null;
        };
        expect(body.format).toBe("offline");
        expect(body.seatsLeft).toBe(5);
      }
    });

    it("020 EARS-1: an event with no seat limit reports seatsLeft null — «unlimited» is not «zero»", async () => {
      const { slug } = await seedEvent({ state: "published", format: "online" });

      const body = (
        await app.inject({ method: "GET", url: `/v1/public/events/${slug}` })
      ).json() as { format: string; seatsLeft: number | null };

      expect(body.format).toBe("online");
      expect(body.seatsLeft).toBeNull();
    });

    it("020 EARS-1: an event seeded before the widening keeps a valid body — the columns are back-fill safe", async () => {
      // A row inserted WITHOUT the two new columns is exactly what every
      // pre-migration production row is; the defaults must make it a valid
      // EventPageView rather than a 500 on the page read.
      const id = randomUUID();
      const slug = `legacy-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published')`,
        [
          id,
          slug,
          "Событие без новых колонок",
          "Кардиология сегодня",
          "2026-07-19T16:00:00.000Z",
          60,
          "Описание.",
          ["cardiology"],
          null,
          null,
        ],
      );
      createdEventIds.push(id);

      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { format: string; seatsLeft: number | null };
      expect(body.format).toBe("online");
      expect(body.seatsLeft).toBeNull();
    });
  },
);
