import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import { CONGRESS_PERSONAL_DATA_PURPOSE } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  congressConfirmationMessage,
  formatCongressEventDate,
} from "../../src/mailer/notice-emails.js";
import { CONGRESS_SIGN_UP_CLOCK } from "../../src/congress/congress-signup.tokens.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

/**
 * 044 slice 4 - the participant's confirmation email (EARS-11/12/13).
 *
 * Its own file rather than more cases in `sign-up.e2e-spec.ts`: this suite
 * needs the mailer token overridden with a controllable fake and the venue key
 * set, and - unlike every other congress case - it asserts something that
 * happens AFTER the response, so each test polls the outcome column instead of
 * reading the answer.
 *
 * Verification rows V-1 / V-2 (the mail clauses), V-3 and V-6.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const CONSENT_VERSION = `2026-10-01.sha256-${"b".repeat(64)}`;
const EVENT_VENUE = "Москва, МВЦ «Крокус Экспо», павильон 3";
const EVENT_TITLE = "Конгресс-2027";
/** 10:00 Moscow on 2027-03-12, as a `timestamptz` instant. */
const EVENT_STARTS_AT = "2027-03-12T07:00:00.000Z";
/** 044 EARS-13 amendment (#2369): wording the letter must never carry. */
const REMOVED_COPY = ["аккаунт", "Пароль не нужен", "Войти", "/login"] as const;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 congress sign-up - confirmation email (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const createdEmails: string[] = [];
    /** Inside the 044 EARS-28 registration window. */
    let now = new Date("2026-11-01T10:00:00.000+03:00");
    /** The runner's default venue, restored so the next file keeps it. */
    let venueBefore: string | undefined;

    const SPECIALTY_ID = randomUUID();

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

    async function post(payload: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: "/v1/congress/sign-up",
        payload,
      });
    }

    /** The mail outcome the intake recorded for this participant, if any. */
    async function mailOutcome(
      email: string,
    ): Promise<{ status: string | null; at: Date | null } | null> {
      const { rows } = await pool.query<{
        confirmation_mail_status: string | null;
        confirmation_mail_at: Date | null;
      }>(
        `SELECT r.confirmation_mail_status, r.confirmation_mail_at
           FROM registrations r
           JOIN users u ON u.id = r.user_id
          WHERE u.email = $1 AND r.event_id = $2`,
        [email, eventId],
      );
      const row = rows[0];
      return row
        ? { status: row.confirmation_mail_status, at: row.confirmation_mail_at }
        : null;
    }

    /**
     * The dispatch runs OFF the response path, so the outcome is awaited by
     * polling the column it writes - bounded, never a fixed sleep.
     */
    async function waitForMailOutcome(
      email: string,
      expected: "sent" | "failed",
    ): Promise<{ status: string | null; at: Date | null }> {
      return vi.waitFor(
        async () => {
          const outcome = await mailOutcome(email);
          expect(outcome?.status).toBe(expected);
          return outcome!;
        },
        { timeout: 5_000, interval: 50 },
      );
    }

    function confirmationsFor(email: string) {
      return mailer.congressConfirmations.filter((sent) => sent.to === email);
    }

    beforeAll(async () => {
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventId;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = CONSENT_VERSION;
      venueBefore = process.env.CONGRESS_SIGNUP_EVENT_VENUE;
      process.env.CONGRESS_SIGNUP_EVENT_VENUE = EVENT_VENUE;
      // See `sign-up.e2e-spec.ts`: the EARS-7 floor is a production
      // calibration, and this suite asserts body/DB facts, not latency.
      process.env.CONGRESS_SIGNUP_TIMING_FLOOR_MS = "5";

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
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
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventId,
          `congress-mail-${eventId.slice(0, 8)}`,
          EVENT_TITLE,
          "Конгресс",
          EVENT_STARTS_AT,
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
      mailer.congressConfirmations.length = 0;
      now = new Date("2026-11-01T10:00:00.000+03:00");
    });

    afterAll(async () => {
      if (pool) await deleteEventFixture(pool, eventId);
      if (app) await app.close();
      if (venueBefore === undefined) {
        delete process.env.CONGRESS_SIGNUP_EVENT_VENUE;
      } else {
        process.env.CONGRESS_SIGNUP_EVENT_VENUE = venueBefore;
      }
    });

    it("044 EARS-11: when the confirmation email cannot be delivered, system shall still accept the submission and keep the registration", async () => {
      const email = uniqueEmail("congress-mail-fail");
      mailer.failNextCongressConfirmation(new Error("relay unreachable"));

      const res = await post(submission(email));

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: "accepted" });

      // The mail is not part of the cascade: the account, the registration and
      // the consent row are committed whether or not the relay answers.
      const rows = await pool.query<{
        registrations: string;
        consents: string;
      }>(
        `SELECT
           (SELECT count(*) FROM registrations r JOIN users u ON u.id = r.user_id
             WHERE u.email = $1 AND r.event_id = $2) AS registrations,
           (SELECT count(*) FROM consent_records c JOIN users u ON u.id = c.user_id
             WHERE u.email = $1 AND c.purpose = $3) AS consents`,
        [email, eventId, CONGRESS_PERSONAL_DATA_PURPOSE],
      );
      expect(rows.rows[0]).toEqual({ registrations: "1", consents: "1" });
    });

    it("044 EARS-12.1: when the relay rejects the confirmation, system shall record the failed outcome on the registration", async () => {
      const email = uniqueEmail("congress-mail-failed-row");
      const before = new Date();
      mailer.failNextCongressConfirmation(new Error("relay unreachable"));

      expect((await post(submission(email))).statusCode).toBe(200);

      const outcome = await waitForMailOutcome(email, "failed");
      expect(outcome.at).toBeInstanceOf(Date);
      expect(outcome.at!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
      expect(confirmationsFor(email)).toHaveLength(0);
    });

    it("044 EARS-12.2: when a participant whose confirmation failed resubmits, system shall send again and record the sent outcome", async () => {
      const email = uniqueEmail("congress-mail-retry");
      mailer.failNextCongressConfirmation(new Error("relay unreachable"));
      expect((await post(submission(email))).statusCode).toBe(200);
      const failed = await waitForMailOutcome(email, "failed");

      expect((await post(submission(email))).statusCode).toBe(200);

      const sent = await waitForMailOutcome(email, "sent");
      expect(confirmationsFor(email)).toHaveLength(1);
      expect(sent.at!.getTime()).toBeGreaterThanOrEqual(failed.at!.getTime());
    });

    it("044 EARS-12.4: when a participant who already had an account resubmits after a failure, system shall send the confirmation again", async () => {
      const { email } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("congress-mail-retry-existing"),
        password: "Aa1!ufficiently-long-pw",
        consent: [{ purpose: "tos", version: "2026-01" }],
      });
      mailer.failNextCongressConfirmation(new Error("relay unreachable"));
      expect((await post(submission(email))).statusCode).toBe(200);
      await waitForMailOutcome(email, "failed");

      expect((await post(submission(email))).statusCode).toBe(200);

      await waitForMailOutcome(email, "sent");
      expect(confirmationsFor(email)).toHaveLength(1);
      expect(confirmationsFor(email)[0]).toMatchObject({ email });
    });

    it("044 EARS-12.3: when a participant whose confirmation was sent resubmits, system shall not send a second email", async () => {
      const email = uniqueEmail("congress-mail-once");
      expect((await post(submission(email))).statusCode).toBe(200);
      const sent = await waitForMailOutcome(email, "sent");
      expect(confirmationsFor(email)).toHaveLength(1);

      expect((await post(submission(email))).statusCode).toBe(200);

      // Proving a negative needs a happens-after barrier rather than a sleep: a
      // LATER submission's dispatch is started after the resubmission's, so its
      // recorded outcome means the resubmission's dispatch has already run.
      const barrier = uniqueEmail("congress-mail-barrier");
      expect((await post(submission(barrier))).statusCode).toBe(200);
      await waitForMailOutcome(barrier, "sent");

      expect(confirmationsFor(email)).toHaveLength(1);
      const after = await mailOutcome(email);
      expect(after!.at!.getTime()).toBe(sent.at!.getTime());
    });

    /**
     * 044 EARS-13 (production amendment 2026-09-24, #2369) — ONE copy for
     * every participant: the letter only confirms the registration. Asserted
     * the same way on both paths so the new-account and existing-account
     * participants provably receive the same letter.
     */
    function expectSingleCopy(dispatched: {
      eventTitle: string;
      eventStartsAt: Date;
      eventVenue: string;
    }): string {
      const message = congressConfirmationMessage({
        eventTitle: dispatched.eventTitle,
        eventDate: formatCongressEventDate(dispatched.eventStartsAt),
        eventVenue: dispatched.eventVenue,
      });
      expect(message.subject).toBe(
        "Doctor.School — вы зарегистрированы на Конгресс-2027",
      );
      expect(message.text).toContain(
        `Вы зарегистрированы на ${EVENT_TITLE}: 12 марта 2027 г. в 10:00, ${EVENT_VENUE}.`,
      );
      expect(message.text).toContain(
        "Если это были не вы, просто проигнорируйте это письмо.",
      );
      for (const removed of REMOVED_COPY) {
        expect(message.text).not.toContain(removed);
        expect(message.html).not.toContain(removed);
      }
      return message.text;
    }

    it("044 EARS-13.1: when the participant is new to the platform, the confirmation shall name the event, its date and venue and carry no account paragraph and no sign-in action", async () => {
      const email = uniqueEmail("congress-mail-new");

      expect((await post(submission(email))).statusCode).toBe(200);
      await waitForMailOutcome(email, "sent");

      const [dispatched] = confirmationsFor(email);
      expect(dispatched).toMatchObject({
        email,
        eventTitle: EVENT_TITLE,
        eventVenue: EVENT_VENUE,
      });
      expect(dispatched!.eventStartsAt.toISOString()).toBe(EVENT_STARTS_AT);
      expectSingleCopy(dispatched!);
    });

    it("044 EARS-13.2: when the participant already has an account, the confirmation shall be the same single copy", async () => {
      const { email } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("congress-mail-existing"),
        password: "Aa1!ufficiently-long-pw",
        consent: [{ purpose: "tos", version: "2026-01" }],
      });

      expect((await post(submission(email))).statusCode).toBe(200);
      await waitForMailOutcome(email, "sent");

      const [dispatched] = confirmationsFor(email);
      expect(dispatched).toMatchObject({ email, eventTitle: EVENT_TITLE });
      expect(expectSingleCopy(dispatched!)).toBe(
        expectSingleCopy({
          eventTitle: EVENT_TITLE,
          eventStartsAt: new Date(EVENT_STARTS_AT),
          eventVenue: EVENT_VENUE,
        }),
      );
    });
  },
);
