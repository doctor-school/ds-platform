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

// 004 EARS-6 — the non-public visibility policy over the two public read
// endpoints (the design §2 visibility table). This is the ONE spec that pins the
// policy end-to-end across all five lifecycle states:
//
//   • `draft` — NOT publicly reachable: the event page returns not-found,
//     BYTE-FOR-BYTE indistinguishable from a request for a non-existent id, so a
//     hidden draft leaks no "exists but private" oracle. A draft never appears on
//     the upcoming listing.
//   • `published` / `live` / `ended` — publicly rendered (the page control that
//     proves `draft` is distinguishable only by being *reachable*, not by a
//     different 404 shape); `published`/`live` list, `ended` drops from the list.
//   • `archived` — the EARS-5 notice on the page (owned by #554, out of scope
//     here); on the listing it never appears.
//
// The EARS-10 invariant this reinforces: the publish-safe projector never returns
// a draft or archived body AS AN ACTIVE event — a draft yields no body at all
// (404), and the upcoming-broadcasts surface (the "active broadcasts" projection)
// only ever carries `published`/`live` cards.
//
// Event authoring / lifecycle transitions are owned by feature 007 (seam →
// parent #549), so this spec SEEDS events directly in each target lifecycle state
// via fixtures. Runs against the dev-stand Postgres; skips when DATABASE_URL is
// absent so the shared CI unit job stays green (requirements Verification, row 6).
describe.skipIf(!process.env.DATABASE_URL)(
  "004 EARS-6 non-public visibility policy (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "published" | "live" | "ended" | "archived";

    interface SeedOptions {
      state: SeedState;
      /** Offset from now (ms) applied to starts_at — default 2h in the future. */
      startsAtOffsetMs?: number;
    }

    /**
     * Seed one event row (+ two ordered speakers) directly in the target
     * lifecycle state — the 004↔007 fixture seam: lifecycle transitions do not
     * exist yet (feature 007), so a visibility test seeds the state it needs. The
     * default `starts_at` is inside the air window (future), so an event's
     * absence from the listing is attributable to its STATE, never a stale clock.
     */
    async function seedEvent(
      opts: SeedOptions,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `vis-${opts.state}-${id.slice(0, 8)}`;
      const startsAt = new Date(
        Date.now() + (opts.startsAtOffsetMs ?? 2 * 60 * 60 * 1000),
      ).toISOString();
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          "Пластика ахиллова сухожилия",
          "Школа травматологии",
          startsAt,
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
         VALUES ($1,0,$2,$3)`,
        [id, "Анна Соколова", "Травматолог-ортопед, к.м.н."],
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
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-6.1: a draft event's public page is not-found, byte-for-byte indistinguishable from a non-existent id (by slug and by id)", async () => {
      const { id, slug } = await seedEvent({ state: "draft" });

      const bySlug = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      const byId = await app.inject({
        method: "GET",
        url: `/v1/public/events/${id}`,
      });
      const unknownSlug = await app.inject({
        method: "GET",
        url: `/v1/public/events/no-such-event-${randomUUID().slice(0, 8)}`,
      });
      const unknownId = await app.inject({
        method: "GET",
        url: `/v1/public/events/${randomUUID()}`,
      });

      // The draft is not publicly reachable — neither its slug nor its real id
      // resolves to a body.
      expect(bySlug.statusCode).toBe(404);
      expect(byId.statusCode).toBe(404);

      // …and its 404 is INDISTINGUISHABLE from an unknown id/slug: same status
      // AND same response body, so a hidden draft leaks no "exists but private"
      // oracle. The slug-vs-slug and id-vs-id pairs are compared so the compared
      // requests differ only in whether the target secretly exists as a draft.
      expect(bySlug.statusCode).toBe(unknownSlug.statusCode);
      expect(bySlug.payload).toBe(unknownSlug.payload);
      expect(byId.statusCode).toBe(unknownId.statusCode);
      expect(byId.payload).toBe(unknownId.payload);
    });

    it.each(["draft", "ended", "archived"] as const)(
      "EARS-6.2: a %s event never appears in the upcoming-broadcasts listing projection",
      async (state) => {
        // Seeded inside the air window (future start), so its absence is due to
        // STATE alone, not the clock. A published control proves the endpoint is
        // returning the listing at all.
        const hidden = await seedEvent({ state });
        const control = await seedEvent({ state: "published" });

        const res = await app.inject({
          method: "GET",
          url: "/v1/public/events?upcoming",
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { id: string; state: string }[];
        const ids = new Set(body.map((c) => c.id));
        expect(ids.has(hidden.id)).toBe(false);
        // The control (published, future) IS listed — so the exclusion above is
        // a real state filter, not an empty/broken response.
        expect(ids.has(control.id)).toBe(true);
      },
    );

    it("EARS-6.3 (EARS-10 invariant): the active-broadcasts listing never carries a non-public body — every card is published or live, never draft/ended/archived", async () => {
      // One event in each of the five states, all inside the air window.
      await seedEvent({ state: "draft" });
      const published = await seedEvent({ state: "published" });
      const live = await seedEvent({ state: "live" });
      await seedEvent({ state: "ended" });
      await seedEvent({ state: "archived" });

      const res = await app.inject({
        method: "GET",
        url: "/v1/public/events?upcoming",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { id: string; state: string }[];
      // The invariant holds across the WHOLE page (including any concurrently
      // seeded events): no non-public event is ever exposed as an active card.
      for (const card of body) {
        expect(["published", "live"]).toContain(card.state);
      }
      // The two active seeds surface; the three non-public seeds do not.
      const ids = new Set(body.map((c) => c.id));
      expect(ids.has(published.id)).toBe(true);
      expect(ids.has(live.id)).toBe(true);
    });
  },
);
