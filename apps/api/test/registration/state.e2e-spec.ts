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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 005 EARS-4 — the per-user EventRegistrationState read composed onto the 004
// event page (GET /v1/events/:idOrSlug/registration), WITHOUT contaminating
// 004's public, cacheable page projection. This spec pins the EARS-4-specific
// contract the EARS-1 flip spec does not:
//
//   • the read reflects the caller's TRUE state — registered → {registered:true,
//     registeredAt}; unregistered → {registered:false};
//   • it returns ONLY the caller's own state — one doctor never sees another
//     doctor's registration state (the EARS-10 cross-cutting AC this endpoint
//     carries);
//   • 004's public GetPublicEventPage stays byte-for-byte content-identical for a
//     guest and an authenticated principal — the registration state is a SEPARATE
//     authenticated read, never folded into the public projection or its cache.
//
// Event authoring / lifecycle transitions are owned by feature 007 (tracked seam
// → parent #564), so this spec SEEDS a `published` event directly. Runs against
// the dev-stand Postgres + the fake IdP for the session; skips when DATABASE_URL
// or IDP_ISSUER is absent so the shared CI unit job stays green (requirements
// Verification, row 4).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-4 per-user EventRegistrationState (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Seed one `published` event directly — the 005↔007 fixture seam. */
    async function seedPublishedEvent(): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `state-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          "Актуальная терапия ХСН",
          "Кардиология сегодня",
          "2026-07-17T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          "published",
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    /** Register + login a doctor_guest; return the session cookie value. */
    async function doctorSession(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      return cookie!.value;
    }

    function cookieHeader(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
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
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-4: the EventRegistrationState read reflects the caller's true state — registered after the write, not-registered before", async () => {
      const { slug } = await seedPublishedEvent();
      const cookie = await doctorSession(uniqueEmail("doc"));
      const headers = cookieHeader(cookie);

      // Unregistered → {registered:false}, no registeredAt.
      const before = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/registration`,
        headers,
      });
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual({ registered: false });

      await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers,
      });

      // Registered → {registered:true, registeredAt}.
      const after = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/registration`,
        headers,
      });
      expect(after.statusCode).toBe(200);
      const body = after.json() as { registered: boolean; registeredAt?: string };
      expect(body.registered).toBe(true);
      expect(typeof body.registeredAt).toBe("string");
      expect(Number.isNaN(Date.parse(body.registeredAt!))).toBe(false);
    });

    it("EARS-10: the EventRegistrationState read returns ONLY the caller's own state — one doctor never sees another doctor's registration", async () => {
      const { slug } = await seedPublishedEvent();
      const cookieA = await doctorSession(uniqueEmail("doc-a"));
      const cookieB = await doctorSession(uniqueEmail("doc-b"));

      // Doctor A registers.
      const reg = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookieA),
      });
      expect(reg.statusCode).toBe(200);

      // Doctor A sees themselves registered.
      const stateA = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookieA),
      });
      expect((stateA.json() as { registered: boolean }).registered).toBe(true);

      // Doctor B — a DIFFERENT caller — sees NOT registered for the same event:
      // the read is scoped to the caller's own registration, never leaks A's.
      const stateB = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookieB),
      });
      expect(stateB.statusCode).toBe(200);
      expect(stateB.json()).toEqual({ registered: false });
    });

    it("EARS-4: the public GetPublicEventPage stays byte-for-byte identical for a guest and an authenticated principal — registration state is a separate authenticated read, not folded into the public projection", async () => {
      const { slug } = await seedPublishedEvent();
      const cookie = await doctorSession(uniqueEmail("doc"));
      const headers = cookieHeader(cookie);

      // Register the doctor, so the ONLY thing that could differ the two public
      // reads is registration-state contamination.
      const reg = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers,
      });
      expect(reg.statusCode).toBe(200);

      // A guest read of the public page (no cookie).
      const guest = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
        headers: device,
      });
      expect(guest.statusCode).toBe(200);

      // The SAME public page read by the authenticated, now-registered principal.
      const principal = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
        headers,
      });
      expect(principal.statusCode).toBe(200);

      // Byte-for-byte identical: the public projection carries no per-session
      // variation — no `registered`/`registeredAt` leaks into it (EARS-4).
      expect(principal.body).toBe(guest.body);
      const projection = guest.json() as Record<string, unknown>;
      expect(projection).not.toHaveProperty("registered");
      expect(projection).not.toHaveProperty("registeredAt");
    });
  },
);
