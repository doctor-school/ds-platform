import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  CONGRESS_PERSONAL_DATA_PURPOSE,
  CongressSignUpAcceptedSchema,
  CongressSignUpWindowRefusalSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { CONGRESS_SIGN_UP_CLOCK } from "../../src/congress/congress-signup.tokens.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

/**
 * 044 slice 2 — the public congress intake, NEW-email path.
 *
 * Verification rows V-1 (minus the confirmation-email clause, which lands with
 * slice 4 / #2304–#2306), V-16 (the registration window), V-17 (the contact
 * phone, new-account half) and EARS-10 (no medical-worker declaration).
 *
 * The cascade is asserted as four rows rather than one: EARS-1 owns the SHAPE
 * (accepted answer, one account + one registration + one consent row), and
 * EARS-4 / EARS-5 / EARS-9 each own the property of one of those three writes,
 * so a regression names the handler that broke rather than "the cascade".
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

// The 044 EARS-5 contract↔column assignability check lives in
// `src/congress/congress-signup.service.ts` (the column's only writer), where
// `tsc` actually compiles it — this directory is outside the API's typecheck.

const CONSENT_VERSION = `2026-10-01.sha256-${"a".repeat(64)}`;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 congress sign-up — public intake, new email (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    /** Wired into the fake IdP so an unwanted verification send is visible. */
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const createdEmails: string[] = [];
    /** The instant the intake sees; every test sets it explicitly (EARS-28). */
    let now = new Date("2026-11-01T10:00:00.000+03:00");

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function submission(
      email: string,
      overrides: Record<string, unknown> = {},
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
        contactPhone: "+7 (900) 123-45-67",
        personalDataConsent: true,
        ...overrides,
      };
    }

    const SPECIALTY_ID = randomUUID();

    async function post(payload: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: "/v1/congress/sign-up",
        payload,
      });
    }

    beforeAll(async () => {
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventId;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = CONSENT_VERSION;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
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
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventId,
          `congress-${eventId.slice(0, 8)}`,
          "Конгресс-2026",
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
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      now = new Date("2026-11-01T10:00:00.000+03:00");
    });

    afterAll(async () => {
      if (pool) await deleteEventFixture(pool, eventId);
      if (app) await app.close();
    });

    it("EARS-1: when a new email submits inside the window, system shall accept it and create account, registration and consent in one cascade", async () => {
      const email = uniqueEmail("congress-new");

      const res = await post(submission(email));

      expect(res.statusCode).toBe(200);
      expect(CongressSignUpAcceptedSchema.parse(res.json())).toEqual({
        status: "accepted",
      });

      const row = await accountRow(email);
      const counts = await pool.query<{
        registrations: string;
        consents: string;
      }>(
        `SELECT
           (SELECT count(*) FROM registrations WHERE user_id = $1) AS registrations,
           (SELECT count(*) FROM consent_records WHERE user_id = $1) AS consents`,
        [row.id],
      );
      // One account, one registration, one consent row — the whole cascade and
      // nothing beyond it. What each of those three rows must CONTAIN is
      // EARS-4 / EARS-5 / EARS-9 below.
      expect(counts.rows[0]).toEqual({ registrations: "1", consents: "1" });
    });

    it("EARS-4: when a congress submission creates an account, system shall create it without any credential and mail no verification", async () => {
      const email = uniqueEmail("congress-passwordless");
      const before = mailer.verificationCodeEmails.length;

      expect((await post(submission(email))).statusCode).toBe(200);

      const row = await accountRow(email);
      // No credential at all: the congress path never asks for a password and
      // never mints one behind the submitter's back.
      expect(fake.hasCredential(row.zitadel_sub)).toBe(false);
      // A guest account, named from the submitted surname + first name.
      expect(row.role).toBe("doctor_guest");
      expect(row.display_name).toBe("Иванова Мария");
      // …and no verification code is sent: a congress sign-up is not a platform
      // registration, so nothing asks the submitter to verify an address.
      expect(
        mailer.verificationCodeEmails.slice(before).map((m) => m.to),
      ).toEqual([]);
    });

    it("EARS-5: when a submission is accepted, system shall store its typed answers on a registration for the configured event and leave the account phone untouched", async () => {
      const email = uniqueEmail("congress-answers");

      expect((await post(submission(email))).statusCode).toBe(200);

      const row = await accountRow(email);
      // The contact phone is an ANSWER on the registration, never a platform
      // identifier on the account.
      expect(row.phone).toBeNull();

      const registration = await pool.query<{
        event_id: string;
        answers: Record<string, unknown> | null;
      }>(`SELECT event_id, answers FROM registrations WHERE user_id = $1`, [
        row.id,
      ]);
      expect(registration.rowCount).toBe(1);
      expect(registration.rows[0]!.event_id).toBe(eventId);
      expect(registration.rows[0]!.answers).toMatchObject({
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        email,
        specialtyId: SPECIALTY_ID,
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Москва",
        contactPhone: "+7 (900) 123-45-67",
        contactPhoneNormalised: "+79001234567",
      });
    });

    it("EARS-9: when a submission is accepted, system shall record exactly one personal-data consent at the SERVER-configured version", async () => {
      const email = uniqueEmail("congress-consent");

      // The version is not a field of the contract; even when one is smuggled
      // onto the body, the recorded version is the server's.
      expect(
        (
          await post(
            submission(email, { consentVersion: "1999-01-01.sha256-forged" }),
          )
        ).statusCode,
      ).toBe(200);

      const row = await accountRow(email);
      const consent = await pool.query<{ purpose: string; version: string }>(
        `SELECT purpose, version FROM consent_records WHERE user_id = $1`,
        [row.id],
      );
      expect(consent.rows).toEqual([
        { purpose: CONGRESS_PERSONAL_DATA_PURPOSE, version: CONSENT_VERSION },
      ]);
    });

    it("EARS-10: when a submission carries no medical-worker declaration, system shall still accept it", async () => {
      const email = uniqueEmail("congress-nodecl");

      const res = await post(submission(email));

      expect(res.statusCode).toBe(200);
      const user = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      );
      const consent = await pool.query<{ purpose: string }>(
        `SELECT purpose FROM consent_records WHERE user_id = $1`,
        [user.rows[0]!.id],
      );
      expect(
        consent.rows.some((c) => c.purpose === "medical-worker-declaration"),
      ).toBe(false);
    });

    it("EARS-28: when a submission arrives before the window opens, system shall refuse it with the opening instant and write nothing", async () => {
      now = new Date("2026-09-01T10:00:00.000+03:00");
      const email = uniqueEmail("congress-early");

      const res = await post(submission(email));

      expect(res.statusCode).toBe(422);
      const refusal = CongressSignUpWindowRefusalSchema.parse(res.json());
      expect(refusal.code).toBe("not-yet-open");
      expect(refusal).toHaveProperty(
        "opensAt",
        "2026-10-01T00:00:00.000+03:00",
      );
      await expectNothingWritten(email);
    });

    it("EARS-28: when a submission arrives after the window closes, system shall refuse it and write nothing", async () => {
      now = new Date("2027-02-01T10:00:00.000+03:00");
      const email = uniqueEmail("congress-late");

      const res = await post(submission(email));

      expect(res.statusCode).toBe(422);
      expect(CongressSignUpWindowRefusalSchema.parse(res.json()).code).toBe(
        "closed",
      );
      await expectNothingWritten(email);
    });

    it("EARS-28: when the window is shut, system shall answer a known and an unknown email identically", async () => {
      const known = uniqueEmail("congress-known");
      expect((await post(submission(known))).statusCode).toBe(200);

      now = new Date("2027-02-01T10:00:00.000+03:00");
      const knownAgain = await post(submission(known));
      const unknown = await post(submission(uniqueEmail("congress-unknown")));

      expect(knownAgain.statusCode).toBe(unknown.statusCode);
      expect(knownAgain.json()).toEqual(unknown.json());
    });

    it("EARS-29: when the contact phone is typed in any accepted form, system shall store one normalised value beside the typed one", async () => {
      const typed = ["+7 (900) 123-45-67", "8 900 123 45 67", "79001234567"];
      const stored: { typed: string; normalised: string }[] = [];

      for (const contactPhone of typed) {
        const email = uniqueEmail("congress-phone");
        expect(
          (await post(submission(email, { contactPhone }))).statusCode,
        ).toBe(200);
        const answers = await pool.query<{
          answers: { contactPhone: string; contactPhoneNormalised: string };
        }>(
          `SELECT r.answers FROM registrations r
             JOIN users u ON u.id = r.user_id
            WHERE u.email = $1`,
          [email],
        );
        const value = answers.rows[0]!.answers;
        stored.push({
          typed: value.contactPhone,
          normalised: value.contactPhoneNormalised,
        });
      }

      expect(stored.map((s) => s.typed)).toEqual(typed);
      expect(new Set(stored.map((s) => s.normalised))).toEqual(
        new Set(["+79001234567"]),
      );
    });

    it("EARS-6: when the email already has an account, system shall refuse generically and write nothing new (slice 3 seam — #2299/#2300/#2301)", async () => {
      const email = uniqueEmail("congress-repeat");
      expect((await post(submission(email))).statusCode).toBe(200);

      const second = await post(submission(email));

      expect(second.statusCode).toBe(422);
      const user = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      );
      expect(user.rowCount).toBe(1);
      const registrations = await pool.query(
        `SELECT 1 FROM registrations WHERE user_id = $1`,
        [user.rows[0]!.id],
      );
      expect(registrations.rowCount).toBe(1);
    });

    /** The single `users` mirror row this address must now have. */
    async function accountRow(email: string): Promise<{
      id: string;
      zitadel_sub: string;
      display_name: string | null;
      phone: string | null;
      role: string;
    }> {
      const user = await pool.query<{
        id: string;
        zitadel_sub: string;
        display_name: string | null;
        phone: string | null;
        role: string;
      }>(
        `SELECT id, zitadel_sub, display_name, phone, role FROM users WHERE email = $1`,
        [email],
      );
      expect(user.rowCount).toBe(1);
      return user.rows[0]!;
    }

    /** No account, no registration, no consent row for this address. */
    async function expectNothingWritten(email: string): Promise<void> {
      const user = await pool.query(`SELECT id FROM users WHERE email = $1`, [
        email,
      ]);
      expect(user.rowCount).toBe(0);
    }
  },
);
