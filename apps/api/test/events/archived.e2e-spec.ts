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

// 004 EARS-5 — the archived direct-link degrade. A sponsor-distributed direct
// link to an event that has since been `archived` (a link already in the wild)
// must NOT dead-end: the read endpoint answers `200 PublicEventPage {state:
// archived}` — the publish-safe body the portal renders as the public
// «мероприятие в архиве» notice with NO participation CTA (owner decision,
// variant «а») — never a `404`, and never a `3xx` redirect to the listing. This
// is the deliberate contrast with a `draft` (EARS-6, a `404` indistinguishable
// from a bad id): a draft was never distributed, an archived event WAS, so the
// two non-page states degrade differently (design §2).
//
// This spec pins the API contract that backs the EARS-5 portal notice: the
// endpoint distinguishes archived (200, reachable) from draft (404, unreachable)
// and from a genuine redirect (there is none). The publish-safe allow-list and
// the "never an ACTIVE body" invariant are EARS-1/EARS-10 (public-event spec);
// here the subject is squarely the archived-link behaviour EARS-5 owns.
//
// Event authoring / lifecycle transitions are owned by feature 007 (seam →
// parent #549), so this spec SEEDS the archived event directly via a fixture.
// Runs against the dev-stand Postgres; skips when DATABASE_URL is absent so the
// shared CI unit job stays green (requirements Verification, row 5).
describe.skipIf(!process.env.DATABASE_URL)(
  "004 EARS-5 archived direct-link public notice (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "archived";

    /**
     * Seed one event row (+ one speaker) directly in the target lifecycle state —
     * the 004↔007 fixture seam (lifecycle transitions are feature 007). The
     * `starts_at` is in the past, the realistic shape of an archived event.
     */
    async function seedEvent(
      state: SeedState,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `arch-${state}-${id.slice(0, 8)}`;
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
          "2026-01-16T16:00:00.000Z",
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

    it("EARS-5: when a visitor requests an archived event via a previously-distributed direct link, the system shall return the archived notice body (200, state archived) — not a 404 and not a redirect", async () => {
      const { slug } = await seedEvent("archived");

      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });

      // The distributed link degrades gracefully: a reachable 200 body, never a
      // 404 dead-end and never a 3xx bounce to the listing.
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      // Labeled `archived` — the portal reads this to render the notice; the CTA
      // is absent on that render (no participation affordance for an archived
      // event, EARS-5), verified on the portal E2E.
      expect(body.state).toBe("archived");
      expect(body.slug).toBe(slug);
    });

    it("EARS-5: the archived direct link resolves by id as well as by slug (a distributed link may carry either)", async () => {
      const { id } = await seedEvent("archived");

      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${id}`,
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { state: string }).state).toBe("archived");
    });

    it("EARS-5: the archived response is a 200 notice body, never a 3xx redirect to the listing", async () => {
      const { slug } = await seedEvent("archived");

      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });

      // Explicitly NOT a redirect — no 3xx status and no Location header steering
      // the recipient to the listing (owner decision «а»: degrade in place).
      expect(res.statusCode).toBeLessThan(300);
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.headers.location).toBeUndefined();
    });

    it("EARS-5: an archived link degrades differently from a draft — archived is a reachable 200 notice, a draft is a 404 (the two non-page states diverge)", async () => {
      const archived = await seedEvent("archived");
      const draft = await seedEvent("draft");

      const archivedRes = await app.inject({
        method: "GET",
        url: `/v1/public/events/${archived.slug}`,
      });
      const draftRes = await app.inject({
        method: "GET",
        url: `/v1/public/events/${draft.slug}`,
      });

      // An archived event (was distributed) is reachable and labeled; a draft
      // (never distributed) is a 404 indistinguishable from a bad id — the
      // deliberate contrast of the two non-page states (design §2).
      expect(archivedRes.statusCode).toBe(200);
      expect((archivedRes.json() as { state: string }).state).toBe("archived");
      expect(draftRes.statusCode).toBe(404);
    });
  },
);
