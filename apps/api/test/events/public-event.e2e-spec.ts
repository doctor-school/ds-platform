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
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// 004 EARS-1 + EARS-10 — the public event-page read endpoint
// (GET /v1/public/events/:idOrSlug → PublicEventPage). A visitor opens a
// sponsor-distributed link and the full publish-safe projection is returned
// server-side WITHOUT authentication; a guest and a logged-in principal receive
// byte-for-byte the same body (no per-session variation). The projection is an
// ALLOW-LIST: no operator/commercial field (raw partner ref, program storage
// key, timestamps) and no registrant PII ever leaks. A draft event is not
// publicly reachable (not-found, indistinguishable from an unknown id); an
// archived event resolves to a 200 body labeled `archived` (never presented as
// an active event). Event authoring / lifecycle transitions are owned by feature
// 007 (seam → parent #549), so this spec SEEDS events directly in each target
// lifecycle state via fixtures. Runs against the dev-stand Postgres; skips when
// DATABASE_URL is absent so the shared CI unit job stays green (requirements
// Verification, rows 1 + 10).
describe.skipIf(!process.env.DATABASE_URL)(
  "004 EARS-1 public event page (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    type SeedState = "draft" | "published" | "live" | "ended" | "archived";

    interface SeedOptions {
      state: SeedState;
      withPdf?: boolean;
      partnerRef?: string | null;
    }

    /**
     * Seed one event row (+ two ordered speakers) directly in the target
     * lifecycle state — the 004↔007 fixture seam: lifecycle transitions do not
     * exist yet (feature 007), so a public-read test seeds the state it needs.
     */
    async function seedEvent(opts: SeedOptions): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `pub-${opts.state}-${id.slice(0, 8)}`;
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
          "2026-07-16T16:00:00.000Z",
          90,
          "Разбор клинических случаев.",
          ["traumatology", "orthopedics"],
          opts.partnerRef === undefined ? "sponsor:acme-pharma" : opts.partnerRef,
          opts.withPdf ? "events/programs/seed/program.pdf" : null,
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

    it.each(["published", "live", "ended"] as const)(
      "EARS-1: when a visitor requests a %s event by its public URL, the system returns the full PublicEventPage projection server-side with no authentication",
      async (state) => {
        const { id, slug } = await seedEvent({ state, withPdf: true });

        const res = await app.inject({
          method: "GET",
          url: `/v1/public/events/${slug}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        expect(body.id).toBe(id);
        expect(body.slug).toBe(slug);
        expect(body.title).toBe("Пластика ахиллова сухожилия");
        expect(body.school).toBe("Школа травматологии");
        expect(body.state).toBe(state);
        expect(body.durationMin).toBe(90);
        // МСК stored as one canonical instant, surfaced as ISO UTC.
        expect(body.startsAt).toBe("2026-07-16T16:00:00.000Z");
        expect(body.specialties).toEqual(["traumatology", "orthopedics"]);
        // Publish-safe speakers: name + credentials, no contact PII.
        expect(body.speakers).toEqual([
          { name: "Анна Соколова", credentials: "Травматолог-ортопед, к.м.н." },
          { name: "Михаил Верещагин", credentials: "Хирург, профессор" },
        ]);
        expect(body.partners).toEqual([{ label: "sponsor:acme-pharma" }]);
        expect(typeof body.programPdfUrl).toBe("string");
      },
    );

    it("EARS-1: resolves by id as well as by slug", async () => {
      const { id } = await seedEvent({ state: "published" });
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${id}`,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { id: string }).id).toBe(id);
    });

    it("EARS-1: a guest and a logged-in principal receive byte-for-byte identical public bodies (no per-session variation)", async () => {
      const { slug } = await seedEvent({ state: "published", withPdf: true });

      const guest = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      // The public route never reads the request subject, so a request that
      // carries a session cookie (a logged-in principal) yields the identical
      // body — proving the response does not vary by authentication state.
      const principal = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=any-session-value` },
      });

      expect(guest.statusCode).toBe(200);
      expect(principal.statusCode).toBe(200);
      expect(principal.payload).toBe(guest.payload);
    });

    it("EARS-2: an event with no program PDF omits programPdfUrl (never a broken/null link)", async () => {
      const { slug } = await seedEvent({ state: "published", withPdf: false });
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect("programPdfUrl" in body).toBe(false);
    });

    it("EARS-10: the projection is an allow-list — no operator/commercial field or registrant PII is exposed", async () => {
      const { slug } = await seedEvent({ state: "published", withPdf: true });
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      const body = res.json() as Record<string, unknown>;
      // Operator/commercial + storage-internal fields are never on the public body.
      for (const forbidden of [
        "partnerRef",
        "programPdfRef",
        "createdAt",
        "updatedAt",
        "validTransitions",
      ]) {
        expect(forbidden in body).toBe(false);
      }
      // The exposed key set is exactly the publish-safe allow-list.
      expect(Object.keys(body).sort()).toEqual(
        [
          "description",
          "durationMin",
          "id",
          "partners",
          "programPdfUrl",
          "school",
          "slug",
          "specialties",
          "speakers",
          "startsAt",
          "state",
          "title",
        ].sort(),
      );
    });

    it("EARS-10: a draft event is not publicly reachable — not-found, indistinguishable from an unknown id", async () => {
      const { slug } = await seedEvent({ state: "draft" });
      const draft = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      expect(draft.statusCode).toBe(404);

      const unknown = await app.inject({
        method: "GET",
        url: `/v1/public/events/${randomUUID()}`,
      });
      expect(unknown.statusCode).toBe(404);
      // Same status + shape → a draft leaks no "exists but hidden" oracle.
      expect(draft.statusCode).toBe(unknown.statusCode);
    });

    it("EARS-10: an archived event resolves to a 200 body labeled archived, never presented as an active event", async () => {
      const { slug } = await seedEvent({ state: "archived" });
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { state: string }).state).toBe("archived");
    });
  },
);
