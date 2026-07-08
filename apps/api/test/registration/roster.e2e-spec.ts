import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { EventRosterSchema } from "@ds/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { RegistrationService } from "../../src/registration/registration.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 005 EARS-8 — the durable registration record + the `EventRoster` read model.
// EARS-1 landed the record + write; this handler pins the durability / roster
// contract layered on top:
//
//   • every registration is DURABLY recorded server-side and is READABLE BACK as
//     the `EventRoster` — the single basis for room admission (006) and the
//     sponsor roster; a fresh read after the write returns the persisted rows;
//   • the record carries NO MORE THAN the `(doctor, event, registeredAt)` fact —
//     the roster entry is exactly {userId, eventId, registeredAt}, no email,
//     name, or any denormalized registrant PII;
//   • every row is CURRENT — wave 1 has no cancelled state, no soft-delete, so
//     the roster is every registration row for the event, no filter (owner
//     decision);
//   • the roster has NO public endpoint — no registrant PII ever leaks onto 004's
//     public projection (GET /v1/public/events/:idOrSlug and the listing), which
//     stays content-identical for guest and principal (EARS-8, EARS-10).
//
// `EventRoster` is an INTERNAL read model (design §4): 005 owns it, 006 + the
// wave-2 report consume it — there is deliberately no HTTP route, so the roster
// is exercised through the injected `RegistrationService` (as 006 will), while
// the no-PII cross-check drives the ACTUAL public 004 routes.
//
// Event authoring / lifecycle transitions are owned by feature 007 (tracked seam
// → parent #564), so this spec SEEDS a `published` event directly. Runs against
// the dev-stand Postgres + the fake IdP for the session; skips when DATABASE_URL
// or IDP_ISSUER is absent so the shared CI unit job stays green (requirements
// Verification, row 8).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "005 EARS-8 durable registration record + EventRoster (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let service: RegistrationService;
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
      const slug = `reg8-${id.slice(0, 8)}`;
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

    /** Register the authenticated doctor for the event via the real command. */
    async function register(slug: string, cookie: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
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
      service = app.get(RegistrationService);
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

    it("EARS-8.1: a registration is durably recorded and readable back as the EventRoster (the 006/roster basis)", async () => {
      const { id: eventId, slug } = await seedPublishedEvent();
      const cookieA = await doctorSession(uniqueEmail("doc-a"));
      const cookieB = await doctorSession(uniqueEmail("doc-b"));

      await register(slug, cookieA);
      await register(slug, cookieB);

      // The roster reads back both current registrations — durable, not in-memory.
      const roster = await service.eventRoster(slug);
      expect(roster).toHaveLength(2);
      // A second, independent read returns the same persisted set (durability).
      const rereadById = await service.eventRoster(eventId);
      expect(rereadById).toHaveLength(2);
      expect(new Set(rereadById.map((e) => e.registeredAt))).toEqual(
        new Set(roster.map((e) => e.registeredAt)),
      );
      // Every entry belongs to this event.
      for (const entry of roster) expect(entry.eventId).toBe(eventId);
    });

    it("EARS-8.2: the roster record carries no more than the (doctor, event, registeredAt) fact — no registrant PII", async () => {
      const { slug } = await seedPublishedEvent();
      const email = uniqueEmail("doc-pii");
      const cookie = await doctorSession(email);
      await register(slug, cookie);

      const roster = await service.eventRoster(slug);
      expect(roster).toHaveLength(1);
      const [entry] = roster;

      // Exactly the three fields — no email/name/sub or any extra column.
      expect(Object.keys(entry).sort()).toEqual([
        "eventId",
        "registeredAt",
        "userId",
      ]);
      // The canonical contract validates and round-trips.
      expect(EventRosterSchema.parse(roster)).toEqual(roster);
      // No registrant PII is present anywhere in the serialized roster.
      const serialized = JSON.stringify(roster);
      expect(serialized).not.toContain(email);
      expect(serialized.toLowerCase()).not.toContain("@ds.test");
      expect(typeof entry.userId).toBe("string");
      expect(Number.isNaN(Date.parse(entry.registeredAt))).toBe(false);
    });

    it("EARS-8.3: every registration row is current — no cancelled state, so a repeat register keeps exactly one current roster entry per doctor", async () => {
      const { slug } = await seedPublishedEvent();
      const cookie = await doctorSession(uniqueEmail("doc-current"));

      // Register twice via the same path — the idempotent upsert (EARS-3).
      await register(slug, cookie);
      await register(slug, cookie);

      // The roster holds exactly one current row for the doctor — no duplicate,
      // and (no cancelled state exists) nothing is filtered out either.
      const roster = await service.eventRoster(slug);
      expect(roster).toHaveLength(1);
      // The registration is still current on a subsequent read — durable.
      expect(await service.eventRoster(slug)).toHaveLength(1);
    });

    it("EARS-8/10: no registrant PII appears on any public 004 endpoint — the public projection stays content-identical for guest and principal", async () => {
      const { slug } = await seedPublishedEvent();
      const email = uniqueEmail("doc-public");
      const cookie = await doctorSession(email);
      await register(slug, cookie);

      // The roster HAS the registrant server-side …
      expect(await service.eventRoster(slug)).toHaveLength(1);

      // … but neither public 004 route surfaces any of it. Drive the real routes.
      const guestPage = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
        headers: device,
      });
      expect(guestPage.statusCode).toBe(200);
      const principalPage = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
        headers: cookieHeader(cookie),
      });
      expect(principalPage.statusCode).toBe(200);
      // Byte-for-byte identical — no per-caller registration leaks in (EARS-8).
      expect(principalPage.body).toBe(guestPage.body);

      const listing = await app.inject({
        method: "GET",
        url: `/v1/public/events`,
        headers: device,
      });
      expect(listing.statusCode).toBe(200);

      // No registrant identity, roster, or registration state on any public body.
      for (const body of [guestPage.body, principalPage.body, listing.body]) {
        const low = body.toLowerCase();
        // No registrant identity, no roster membership, and no per-caller
        // registration state on any public 004 body (EARS-8, EARS-10).
        expect(body).not.toContain(email);
        expect(low).not.toContain("@ds.test");
        expect(low).not.toContain("registrant");
        expect(low).not.toContain("registeredat");
        expect(low).not.toContain('"registered"');
      }
    });
  },
);
