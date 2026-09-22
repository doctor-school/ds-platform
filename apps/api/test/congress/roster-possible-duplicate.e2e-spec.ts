import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { CongressSignUpAcceptedSchema, EventRosterSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { CONGRESS_SIGN_UP_CLOCK } from "../../src/congress/congress-signup.tokens.js";
import { RegistrationService } from "../../src/registration/registration.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

/**
 * 044 EARS-30 — the read-time «возможный дубль» marker on the `EventRoster`
 * read model (requirements Verification row V-18).
 *
 * The marker is NOT a stored flag and NOT a write: `findEventRoster` derives it
 * per read by counting, inside the event, the registrations that share the
 * normalised contact phone EARS-29 keeps on `registrations.answers`. Three
 * properties are pinned here, one per handler clause:
 *
 *   • a shared phone changes NOTHING about acceptance — both submissions get the
 *     byte-identical EARS-7 success body — and marks BOTH rows, while a row with
 *     an unrelated phone stays unmarked;
 *   • because the marker is derived, removing one of the sharing registrations
 *     clears the survivor marker with NO write to the surviving row — asserted
 *     against a `to_jsonb` snapshot of the row taken before the deletion;
 *   • a platform-origin row (EARS-16, `answers IS NULL`) carries no contact
 *     phone and is never marked — several such rows on one event do not group
 *     with each other through their common NULL key.
 *
 * The roster is an internal read model with no HTTP route (005 design §4), so it
 * is exercised through the injected `RegistrationService`, exactly as feature
 * 006 consumes it. The congress rows are created through the REAL public intake
 * and the platform-origin rows through the REAL signed-in registration command —
 * no row is hand-inserted, so the derivation is checked against the shape the
 * production writers actually produce.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const CONSENT_VERSION = `2026-10-01.sha256-${"b".repeat(64)}`;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-30 — read-time possible-duplicate marker on the event roster (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let service: RegistrationService;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const eventSlug = `congress-dup-${eventId.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const SPECIALTY_ID = randomUUID();
    /** Inside the EARS-28 registration window for every test here. */
    const now = new Date("2026-11-01T10:00:00.000+03:00");

    // The signed-in platform path (EARS-16) needs a real credentialed account.
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function submission(
      email: string,
      contactPhone: string,
    ): Record<string, unknown> {
      return {
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        email,
        specialtyId: SPECIALTY_ID,
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Москва",
        contactPhone,
        personalDataConsent: true,
      };
    }

    /** One public congress intake; returns the parsed success body. */
    async function signUp(email: string, contactPhone: string) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/congress/sign-up",
        payload: submission(email, contactPhone),
      });
      expect(res.statusCode).toBe(200);
      return CongressSignUpAcceptedSchema.parse(res.json());
    }

    /** Register + login a doctor_guest; returns the session cookie value. */
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

    /** The signed-in platform registration (EARS-16): no answers payload. */
    async function registerAsDoctor(email: string): Promise<void> {
      const cookie = await doctorSession(email);
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${eventSlug}/registration`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(res.statusCode).toBe(200);
    }

    async function userIdOf(email: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!.id;
    }

    /** The roster of the congress event, indexed by the registrant user id. */
    async function markers(): Promise<Map<string, boolean>> {
      const roster = await service.eventRoster(eventId);
      // The canonical contract validates and round-trips on every read.
      expect(EventRosterSchema.parse(roster)).toEqual(roster);
      return new Map(roster.map((e) => [e.userId, e.possibleDuplicate]));
    }

    beforeAll(async () => {
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventId;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = CONSENT_VERSION;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        // 044 EARS-11: the intake dispatches a confirmation email after
        // every acceptance. Without this the suite would make a real relay
        // attempt per submission and record `failed` on rows it never reads.
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(CONGRESS_SIGN_UP_CLOCK)
        .useValue(() => now)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      service = app.get(RegistrationService);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventId,
          eventSlug,
          "Конгресс-2027",
          "Конгресс",
          "2026-11-20T09:00:00.000Z",
          480,
          "Ежегодный конгресс.",
          ["cardiology"],
          "sponsor:congress",
          null,
          "published",
        ],
      );
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      if (pool) await deleteEventFixture(pool, eventId);
      if (app) await app.close();
    });

    it("EARS-30.1: when two registrations of one event carry differently typed but equal phones, system shall accept both identically and mark both possible-duplicate", async () => {
      const sharedA = uniqueEmail("dup-a");
      const sharedB = uniqueEmail("dup-b");
      const other = uniqueEmail("dup-c");

      // Acceptance is unchanged: the same generic EARS-7 body, byte-identical
      // across the two submissions that share a phone and the one that does not
      // — the intake never signals that another registration carries it.
      const bodyA = await signUp(sharedA, "+7 (999) 123-45-67");
      const bodyB = await signUp(sharedB, "8 999 1234567");
      const bodyC = await signUp(other, "+7 (912) 000-11-22");
      expect(bodyB).toEqual(bodyA);
      expect(bodyC).toEqual(bodyA);

      const marked = await markers();
      expect(marked.get(await userIdOf(sharedA))).toBe(true);
      expect(marked.get(await userIdOf(sharedB))).toBe(true);
      expect(marked.get(await userIdOf(other))).toBe(false);
    });

    it("EARS-30.2: when one sharing registration is deleted, system shall clear the survivor marker with no write to the surviving row", async () => {
      const survivorEmail = uniqueEmail("dup-survivor");
      const removedEmail = uniqueEmail("dup-removed");
      await signUp(survivorEmail, "+7 (999) 222-33-44");
      await signUp(removedEmail, "8 999 2223344");

      const survivorId = await userIdOf(survivorEmail);
      const removedId = await userIdOf(removedEmail);
      expect((await markers()).get(survivorId)).toBe(true);

      // The whole surviving row, as the database holds it before the deletion.
      const before = await pool.query<{ row: unknown }>(
        `SELECT to_jsonb(r) AS row FROM registrations r
          WHERE r.event_id = $1 AND r.user_id = $2`,
        [eventId, survivorId],
      );
      expect(before.rows).toHaveLength(1);

      // The manual deletion-on-request by the team — only the row this test
      // created, on the test database, whose fixtures this suite owns.
      await pool.query(
        "DELETE FROM registrations WHERE event_id = $1 AND user_id = $2",
        [eventId, removedId],
      );

      // The marker disappears by itself, because it was never stored …
      expect((await markers()).get(survivorId)).toBe(false);
      // … and nothing was written to the surviving row to make that happen.
      const after = await pool.query<{ row: unknown }>(
        `SELECT to_jsonb(r) AS row FROM registrations r
          WHERE r.event_id = $1 AND r.user_id = $2`,
        [eventId, survivorId],
      );
      expect(after.rows[0]!.row).toEqual(before.rows[0]!.row);
    });

    it("EARS-30.3: when a registration has no answers payload, system shall never mark it", async () => {
      // Platform-origin rows (EARS-16): three signed-in doctors, no answers at
      // all. Their comparison key is NULL for every one of them, and a NULL key
      // must never group — not even with the other NULLs.
      const emails = [
        uniqueEmail("platform-a"),
        uniqueEmail("platform-b"),
        uniqueEmail("platform-c"),
      ];
      for (const email of emails) await registerAsDoctor(email);

      const ids = await Promise.all(emails.map((e) => userIdOf(e)));
      const { rows } = await pool.query<{ answers: unknown }>(
        `SELECT answers FROM registrations
          WHERE event_id = $1 AND user_id = ANY($2::uuid[])`,
        [eventId, ids],
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.answers).toBeNull();

      const marked = await markers();
      for (const id of ids) expect(marked.get(id)).toBe(false);
    });
  },
);
