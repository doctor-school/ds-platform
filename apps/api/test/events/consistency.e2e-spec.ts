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

// 004 EARS-9 — cross-surface live-state consistency. This handler does not
// re-implement the event page (EARS-1/EARS-4) or the upcoming listing (EARS-7);
// it ASSERTS their consistency. Both public surfaces derive their rendered
// lifecycle from ONE `EventLifecycleState` column (design §2, §5.3), so a live
// event reads "live" on both its listing card and its event page, and the two
// surfaces can never present a contradictory signal for one event — there is no
// second projection to drift. A short `Cache-Control` max-age (design §4, §5.3)
// bounds how long a just-transitioned event can look stale on either endpoint,
// and an event whose state has moved to `ended`/`archived` drops from the
// listing on the NEXT read. Event authoring / lifecycle transitions are feature
// 007 (seam → parent #549), so this spec SEEDS events directly in each target
// lifecycle state via fixtures and simulates a transition by moving one seeded
// event's own `state` column (an isolated, self-owned row on the branch DB — the
// same mutation 007 will apply through its guarded command). Runs against the
// dev-stand Postgres; skips when DATABASE_URL is absent so the shared CI unit job
// stays green (requirements Verification, row 9).
describe.skipIf(!process.env.DATABASE_URL)(
  "004 EARS-9 cross-surface live-state consistency (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "published" | "live" | "ended" | "archived";

    /**
     * Seed one event row (+ two ordered speakers) directly in the target
     * lifecycle state and start time — the 004↔007 fixture seam: lifecycle
     * transitions do not exist yet (feature 007), so a consistency test seeds the
     * state + time it needs. `startsAtOffsetMs` is applied to `now` (negative =
     * in the past) so a `live` seed can already be airing.
     */
    async function seedEvent(
      state: SeedState,
      startsAtOffsetMs: number,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `cons-${state}-${id.slice(0, 8)}`;
      const startsAt = new Date(Date.now() + startsAtOffsetMs).toISOString();
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
          state,
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
      return { id, slug };
    }

    /**
     * Simulate a feature-007 lifecycle transition by moving one seeded event's own
     * `state` column — the single write both public surfaces read. Scoped to a
     * self-owned row on the branch DB (never a shared or foreign row); it stands
     * in for 007's guarded transition until it lands, exercising the "drops on the
     * next read" re-read semantics of EARS-9.
     */
    async function moveState(id: string, to: SeedState): Promise<void> {
      await pool.query("UPDATE events SET state = $2 WHERE id = $1", [id, to]);
    }

    const HOUR = 60 * 60 * 1000;

    async function fetchPage(idOrSlug: string) {
      return app.inject({
        method: "GET",
        url: `/v1/public/events/${idOrSlug}`,
      });
    }

    async function fetchListing() {
      return app.inject({ method: "GET", url: "/v1/public/events?upcoming" });
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

    it("EARS-9: when an event is live, the system shall report the same `live` state on both its listing card and its event page (single source of truth)", async () => {
      const { id, slug } = await seedEvent("live", -30 * 60 * 1000); // airing 30m

      const [pageRes, listRes] = await Promise.all([
        fetchPage(slug),
        fetchListing(),
      ]);
      expect(pageRes.statusCode).toBe(200);
      expect(listRes.statusCode).toBe(200);

      const page = pageRes.json() as { id: string; state: string };
      const cards = listRes.json() as { id: string; state: string }[];
      const card = cards.find((c) => c.id === id);

      // The card is present on the listing…
      expect(card).toBeDefined();
      // …and BOTH surfaces read "live" from the one `EventLifecycleState` column —
      // the card's state equals the page's state equals `live`. There is no second
      // projection that could disagree.
      expect(page.state).toBe("live");
      expect(card?.state).toBe("live");
      expect(card?.state).toBe(page.state);
    });

    it("EARS-9: when the same event is read on both surfaces, the system shall never present a contradictory state (both derive from one EventLifecycleState)", async () => {
      // Every state the listing can carry (`published`, `live`) must agree with
      // the page's state for the same event — the invariant, not a single case.
      for (const state of ["published", "live"] as const) {
        const { id, slug } = await seedEvent(state, 2 * HOUR);
        const [pageRes, listRes] = await Promise.all([
          fetchPage(slug),
          fetchListing(),
        ]);
        const page = pageRes.json() as { state: string };
        const cards = listRes.json() as { id: string; state: string }[];
        const card = cards.find((c) => c.id === id);
        expect(card).toBeDefined();
        // The card and the page can never disagree for one event.
        expect(card?.state).toBe(page.state);
        expect(page.state).toBe(state);
      }
    });

    it("EARS-9: when an event transitions to ended, the system shall drop its card from the listing on the next read while the page still resolves", async () => {
      const { id, slug } = await seedEvent("live", -30 * 60 * 1000);

      // First read: the live event is on the listing.
      const before = (await fetchListing()).json() as { id: string }[];
      expect(before.some((c) => c.id === id)).toBe(true);

      // 007 ends the broadcast — the single `state` write.
      await moveState(id, "ended");

      // Next read: the card is gone from the listing (dropped by STATE)…
      const after = (await fetchListing()).json() as { id: string }[];
      expect(after.some((c) => c.id === id)).toBe(false);

      // …yet the event page still resolves publicly and now reads `ended` — the
      // same single source of truth, consistent across the re-read.
      const pageRes = await fetchPage(slug);
      expect(pageRes.statusCode).toBe(200);
      expect((pageRes.json() as { state: string }).state).toBe("ended");
    });

    it("EARS-9: when an event is archived, the system shall drop its card from the listing on the next read while the direct link degrades to the archived notice body", async () => {
      const { id, slug } = await seedEvent("live", -30 * 60 * 1000);
      expect(
        ((await fetchListing()).json() as { id: string }[]).some(
          (c) => c.id === id,
        ),
      ).toBe(true);

      // 007 archives the event — the single `state` write.
      await moveState(id, "archived");

      // The card drops from the listing on the next read…
      const after = (await fetchListing()).json() as { id: string }[];
      expect(after.some((c) => c.id === id)).toBe(false);

      // …and the previously-distributed direct link degrades to a public 200
      // `archived` body (never a 404), consistent with the same state column.
      const pageRes = await fetchPage(slug);
      expect(pageRes.statusCode).toBe(200);
      expect((pageRes.json() as { state: string }).state).toBe("archived");
    });

    it("EARS-9: when either public read endpoint is queried, the system shall return a short Cache-Control max-age that bounds the staleness of a just-transitioned event", async () => {
      const { slug } = await seedEvent("live", -30 * 60 * 1000);

      // Both public read surfaces carry a shared-cacheable, short-max-age header so
      // a live↔ended flip surfaces within the window (design §4, §5.3) — the
      // "never stale" half of EARS-9. No per-user variation ⇒ `public` is safe.
      // Read the header off a 200 response (an exception-mapped 404 does not carry
      // the handler's `@Header`), so a real seeded event page is fetched.
      const listing = (await fetchListing()).headers["cache-control"];
      const pageHeader = (await fetchPage(slug)).headers["cache-control"];

      for (const header of [listing, pageHeader]) {
        expect(header).toBeDefined();
        const value = String(header);
        expect(value).toContain("public");
        const maxAge = /max-age=(\d+)/.exec(value);
        expect(maxAge).not.toBeNull();
        // Short bound: staleness is capped at at most a minute, not indefinite.
        expect(Number(maxAge?.[1])).toBeGreaterThan(0);
        expect(Number(maxAge?.[1])).toBeLessThanOrEqual(60);
      }
    });
  },
);
