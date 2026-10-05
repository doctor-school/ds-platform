import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CongressDeskRegistrationResponseSchema } from "@ds/schemas";
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
import { establishAdminSession } from "../setup/admin-session.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 044 EARS-35 / EARS-38 — V-26 and the desk half of V-28: the registrar's
 * manual registration, `POST /v1/admin/events/:idOrSlug/registrations`.
 *
 * The desk entry is driven through the REAL route on the REAL module, and the
 * assertions read what the ONE congress intake use-case wrote: the account
 * (credential-less), the registration (`intake_origin = 'desk'`), the consent
 * row (`origin = 'paper'`, server-stamped version), the confirmation email and
 * its recorded outcome, and the 010 ledger row naming the registrar as actor.
 *
 * The public registration window is CLOSED for this whole suite (the injected
 * clock sits after `CONGRESS_SIGNUP_WINDOW_CLOSES_AT`) — the desk is where
 * walk-ins arrive, on the congress days, after the site form has shut. The one
 * case that needs the site form (EARS-35 f) opens the clock for its own
 * submission and closes it again.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const CONSENT_VERSION = `2026-10-01.sha256-${"d".repeat(64)}`;
const WINDOW_OPENS_AT = "2026-10-01T00:00:00.000+03:00";
const WINDOW_CLOSES_AT = "2027-01-01T00:00:00.000+03:00";
/** After the window: the site form refuses, the desk must not. */
const CLOSED = new Date("2027-04-23T09:00:00.000+03:00");
const OPEN = new Date("2026-11-01T10:00:00.000+03:00");

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-35 — manual registration at the desk (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventA = randomUUID();
    const eventB = randomUUID();
    const slugA = `congress-desk-a-${eventA.slice(0, 8)}`;
    const slugB = `congress-desk-b-${eventB.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const SPECIALTY_ID = randomUUID();
    let now = CLOSED;
    let registrar: { headers: Record<string, string>; sub: string };
    let admin: { headers: Record<string, string>; sub: string };

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function entry(
      email: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        surname: "Кузнецова",
        firstName: "Анна",
        email,
        specialtyId: SPECIALTY_ID,
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Москва",
        contactPhone: "+7 (900) 765-43-21",
        paperConsent: true,
        ...overrides,
      };
    }

    async function desk(
      headers: Record<string, string>,
      event: string,
      payload: Record<string, unknown>,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${event}/registrations`,
        headers,
        payload,
      });
    }

    /** A registered account holding `role` and a REAL admin session. */
    async function adminPrincipal(
      prefix: string,
      role: "platform_admin" | "event-registrar",
      boundTo?: string,
    ): Promise<{ headers: Record<string, string>; sub: string }> {
      const email = uniqueEmail(prefix);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      const sub = rows[0]!.zitadel_sub;
      await fake.grantProjectRole(sub, role);
      if (boundTo) {
        await pool.query(
          `INSERT INTO event_role_grants (user_id, role, event_id)
           SELECT id, 'event-registrar', $2 FROM users WHERE zitadel_sub = $1`,
          [sub, boundTo],
        );
      }
      const session = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return { headers: session.headers, sub };
    }

    async function snapshot(email: string) {
      const { rows } = await pool.query<{
        id: string;
        zitadel_sub: string;
      }>("SELECT id, zitadel_sub FROM users WHERE email = $1", [email]);
      const user = rows[0];
      if (!user) return { users: 0, registrations: [], consents: [] };
      const registrations = await pool.query<{
        id: string;
        event_id: string;
        intake_origin: string;
        account_created_by_intake: boolean | null;
      }>(
        `SELECT id, event_id, intake_origin, account_created_by_intake
           FROM registrations WHERE user_id = $1 ORDER BY registered_at`,
        [user.id],
      );
      const consents = await pool.query<{
        purpose: string;
        version: string;
        origin: string | null;
      }>(
        `SELECT purpose, version, origin FROM consent_records
          WHERE user_id = $1 ORDER BY captured_at`,
        [user.id],
      );
      return {
        users: rows.length,
        sub: user.zitadel_sub,
        registrations: registrations.rows,
        consents: consents.rows,
      };
    }

    async function waitForMailOutcome(registrationId: string): Promise<string> {
      return vi.waitFor(
        async () => {
          const { rows } = await pool.query<{
            confirmation_mail_status: string | null;
          }>(
            "SELECT confirmation_mail_status FROM registrations WHERE id = $1",
            [registrationId],
          );
          expect(rows[0]?.confirmation_mail_status).toBe("sent");
          return rows[0]!.confirmation_mail_status!;
        },
        { timeout: 5_000, interval: 50 },
      );
    }

    function confirmationsFor(email: string) {
      return mailer.congressConfirmations.filter((sent) => sent.to === email);
    }

    async function insertEvent(id: string, slug: string, title: string) {
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline', ${eventClassificationSql()})`,
        [
          id,
          slug,
          title,
          "Конгресс",
          "2027-04-23T09:00:00.000Z",
          480,
          "Ежегодный конгресс.",
          ["cardiology"],
          "sponsor:congress",
          null,
          "published",
        ],
      );
    }

    beforeAll(async () => {
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventA;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = CONSENT_VERSION;
      process.env.CONGRESS_SIGNUP_WINDOW_OPENS_AT = WINDOW_OPENS_AT;
      process.env.CONGRESS_SIGNUP_WINDOW_CLOSES_AT = WINDOW_CLOSES_AT;
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
      await insertEvent(eventA, slugA, "Конгресс А");
      await insertEvent(eventB, slugB, "Конгресс Б");

      registrar = await adminPrincipal(
        "desk-registrar",
        "event-registrar",
        eventA,
      );
      admin = await adminPrincipal("desk-admin", "platform_admin");
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventA);
        await deleteEventFixture(pool, eventB);
      }
      if (app) await app.close();
      delete process.env.CONGRESS_SIGNUP_TIMING_FLOOR_MS;
    });

    let walkIn: { email: string; registrationId: string };

    it("044 EARS-35.1: a registrar bound to the event enters a walk-in with the window closed and no captcha — one credential-less account, one desk registration, one paper consent, the same confirmation email", async () => {
      const email = uniqueEmail("desk-walkin");

      const res = await desk(registrar.headers, slugA, entry(email));

      expect(res.statusCode).toBe(200);
      const body = CongressDeskRegistrationResponseSchema.parse(res.json());
      expect(body.status).toBe("accepted");

      const state = await snapshot(email);
      expect(state.users).toBe(1);
      expect(fake.hasCredential(state.sub!)).toBe(false);
      expect(state.registrations).toHaveLength(1);
      expect(state.registrations[0]).toMatchObject({
        id: body.registrationId,
        event_id: eventA,
        intake_origin: "desk",
        account_created_by_intake: true,
      });
      expect(state.consents).toEqual([
        {
          purpose: "congress-personal-data",
          version: CONSENT_VERSION,
          origin: "paper",
        },
      ]);

      // EARS-11…EARS-13: the SAME confirmation the site form sends, with its
      // outcome recorded on the row.
      expect(await waitForMailOutcome(body.registrationId)).toBe("sent");
      const sent = confirmationsFor(email);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.eventTitle).toBe("Конгресс А");

      // 010: the registration row's ledger entry names the registrar.
      const ledger = await pool.query<{
        subject_id: string | null;
        source: string;
      }>(
        `SELECT subject_id, metadata ->> 'source' AS source FROM audit_ledger
          WHERE event_type = 'data.registrations.insert'
            AND metadata -> 'pk' ->> 'id' = $1`,
        [body.registrationId],
      );
      expect(ledger.rows).toEqual([
        { subject_id: registrar.sub, source: "admin-ui" },
      ]);
      // The auth-audit accounting the high-stakes registry declares for this
      // route: the new account's one `auth.register` row, appended by the
      // delegated account-creation command site.
      const authRows = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_ledger
          WHERE event_type = 'auth.register' AND subject_id = $1`,
        [state.sub],
      );
      expect(authRows.rows[0]!.n).toBe(1);

      walkIn = { email, registrationId: body.registrationId };
    });

    it("046 EARS-15: the confirmation from the desk carries no link, no button and no URL — neither /account/congress nor any href — in the HTML and the text part", async () => {
      const email = uniqueEmail("desk-no-link");

      const res = await desk(registrar.headers, slugA, entry(email));
      expect(res.statusCode).toBe(200);
      const body = CongressDeskRegistrationResponseSchema.parse(res.json());
      expect(await waitForMailOutcome(body.registrationId)).toBe("sent");

      const [dispatched] = confirmationsFor(email);
      expect(dispatched).not.toHaveProperty("cabinetUrl");
      const message = congressConfirmationMessage({
        eventTitle: dispatched!.eventTitle,
        eventDate: formatCongressEventDate(dispatched!.eventStartsAt),
        eventVenue: dispatched!.eventVenue,
      });
      expect(message.html).not.toMatch(/href=/);
      for (const part of [message.text, message.html]) {
        expect(part).not.toContain("/account/congress");
        expect(part).not.toMatch(/https?:\/\//);
        expect(part).not.toContain("Подать материалы в кабинете");
      }
    });

    it("044 EARS-35.2: the same email entered again names the existing registration and writes nothing new — no second account, registration, consent or email", async () => {
      const before = await snapshot(walkIn.email);

      const res = await desk(registrar.headers, slugA, entry(walkIn.email));

      expect(res.statusCode).toBe(200);
      expect(CongressDeskRegistrationResponseSchema.parse(res.json())).toEqual({
        status: "existing",
        registrationId: walkIn.registrationId,
      });
      expect(await snapshot(walkIn.email)).toEqual(before);
      // The first confirmation was `sent`; a repeat never mails again (EARS-12).
      await new Promise((r) => setTimeout(r, 200));
      expect(confirmationsFor(walkIn.email)).toHaveLength(1);
    });

    it("044 EARS-35.3: a desk entry without the paper-consent tick is refused before anything is written or mailed", async () => {
      const email = uniqueEmail("desk-noconsent");
      const { paperConsent: _omit, ...withoutTick } = entry(email);
      void _omit;

      const res = await desk(registrar.headers, slugA, withoutTick);

      expect(res.statusCode).toBe(400);
      expect(await snapshot(email)).toEqual({
        users: 0,
        registrations: [],
        consents: [],
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(confirmationsFor(email)).toHaveLength(0);
    });

    it("044 EARS-38: a bound registrar whose role the IdP has since withdrawn is refused live on the desk write and nothing is written (#1304)", async () => {
      const revoked = await adminPrincipal(
        "desk-revoked",
        "event-registrar",
        eventA,
      );
      await fake.revokeProjectRole(revoked.sub, "event-registrar");
      const email = uniqueEmail("desk-revoked-entry");

      const res = await desk(revoked.headers, slugA, entry(email));

      expect(res.statusCode).toBe(403);
      expect((res.json() as { errorCode: string }).errorCode).toBe(
        "EVENT_REGISTRAR_REQUIRED",
      );
      expect(await snapshot(email)).toEqual({
        users: 0,
        registrations: [],
        consents: [],
      });
    });

    it("044 EARS-38: the registrar bound to event A is refused on event B with EVENT_BINDING_REQUIRED and nothing is written", async () => {
      const email = uniqueEmail("desk-other-event");

      const res = await desk(registrar.headers, slugB, entry(email));

      expect(res.statusCode).toBe(403);
      expect((res.json() as { errorCode: string }).errorCode).toBe(
        "EVENT_BINDING_REQUIRED",
      );
      expect(await snapshot(email)).toEqual({
        users: 0,
        registrations: [],
        consents: [],
      });
    });

    it("044 EARS-38: an unknown event answers the same EVENT_BINDING_REQUIRED as another event — the desk learns nothing about which events exist", async () => {
      const res = await desk(
        registrar.headers,
        "no-such-congress",
        entry(uniqueEmail("desk-unknown-event")),
      );

      expect(res.statusCode).toBe(403);
      expect((res.json() as { errorCode: string }).errorCode).toBe(
        "EVENT_BINDING_REQUIRED",
      );
    });

    it("044 EARS-38: a registrar whose event binding row was withdrawn after sign-in is refused with EVENT_BINDING_REQUIRED (a credential refusal, never a retry) and nothing is written", async () => {
      const unbound = await adminPrincipal(
        "desk-unbound",
        "event-registrar",
        eventA,
      );
      await pool.query(
        `DELETE FROM event_role_grants
          WHERE user_id = (SELECT id FROM users WHERE zitadel_sub = $1)`,
        [unbound.sub],
      );
      const email = uniqueEmail("desk-unbound-entry");

      const res = await desk(unbound.headers, slugA, entry(email));

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        status: 403,
        errorCode: "EVENT_BINDING_REQUIRED",
      });
      expect(await snapshot(email)).toEqual({
        users: 0,
        registrations: [],
        consents: [],
      });
    });

    it("044 EARS-35.4: a platform administrator is not limited by any binding and registers into any event", async () => {
      const email = uniqueEmail("desk-admin-entry");

      const res = await desk(admin.headers, eventB, entry(email));

      expect(res.statusCode).toBe(200);
      const body = CongressDeskRegistrationResponseSchema.parse(res.json());
      expect(body.status).toBe("accepted");
      const state = await snapshot(email);
      expect(state.registrations).toEqual([
        expect.objectContaining({
          id: body.registrationId,
          event_id: eventB,
          intake_origin: "desk",
        }),
      ]);
    });

    it("044 EARS-35.5: an account the site form created is attached to a desk registration for another event, with its origin 'desk' and the account path recorded, never answered", async () => {
      const email = uniqueEmail("desk-existing");
      now = OPEN;
      try {
        const site = await app.inject({
          method: "POST",
          url: "/v1/congress/sign-up",
          payload: {
            ...entry(email, { paperConsent: undefined }),
            personalDataConsent: true,
          },
        });
        expect(site.statusCode).toBe(200);
      } finally {
        now = CLOSED;
      }

      const res = await desk(admin.headers, slugB, entry(email));

      expect(res.statusCode).toBe(200);
      const body = CongressDeskRegistrationResponseSchema.parse(res.json());
      // The response is the new registration — and says nothing about the
      // account having existed (the strict schema would refuse an extra key).
      expect(body.status).toBe("accepted");
      const state = await snapshot(email);
      expect(state.users).toBe(1);
      expect(state.registrations).toEqual([
        expect.objectContaining({
          event_id: eventA,
          intake_origin: "site",
          account_created_by_intake: true,
        }),
        expect.objectContaining({
          id: body.registrationId,
          event_id: eventB,
          intake_origin: "desk",
          account_created_by_intake: false,
        }),
      ]);
      // One consent per version (EARS-9): the online acceptance already
      // covers the server-stamped version, so the desk writes no second row.
      expect(state.consents).toEqual([
        {
          purpose: "congress-personal-data",
          version: CONSENT_VERSION,
          origin: null,
        },
      ]);
    });

    it("044 EARS-35.6: migration 0040's backfill reads 'site' for a registration carrying answers and 'platform' for one without", async () => {
      // No migration-test harness exists in this repo, so the backfill
      // statement is read VERBATIM from the committed migration file and run
      // against pre-migration-shaped rows (intake_origin NULL). No DDL touches
      // the real `registrations` table (it would take an ACCESS EXCLUSIVE lock
      // that stalls other e2e files sharing this database): the rows live in a
      // session TEMP table of the same name. `pg_temp` is searched before
      // `public`, so the migration's unqualified `"registrations"` resolves to
      // the scratch table; `ON COMMIT DROP` + ROLLBACK leave no trace.
      const sql = readFileSync(
        new URL(
          "../../drizzle/0040_desk_registration_origins.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const backfill = sql
        .split("--> statement-breakpoint")
        .map((s) =>
          s
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .find((s) => s.startsWith("UPDATE"));
      expect(backfill).toBeDefined();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `CREATE TEMP TABLE registrations
             (id int PRIMARY KEY, answers jsonb, intake_origin text)
           ON COMMIT DROP`,
        );
        // The scratch table really is the one the statement will hit.
        const resolved = await client.query<{ temp: boolean }>(
          `SELECT n.nspname LIKE 'pg_temp%' AS temp
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = '"registrations"'::regclass`,
        );
        expect(resolved.rows[0]?.temp).toBe(true);
        await client.query(
          `INSERT INTO registrations (id, answers, intake_origin) VALUES
             (1, '{"surname":"Иванова"}'::jsonb, NULL),
             (2, NULL, NULL)`,
        );
        await client.query(backfill!);
        const { rows } = await client.query<{
          id: number;
          intake_origin: string;
        }>("SELECT id, intake_origin FROM registrations ORDER BY id");
        expect(rows).toEqual([
          { id: 1, intake_origin: "site" },
          { id: 2, intake_origin: "platform" },
        ]);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);
