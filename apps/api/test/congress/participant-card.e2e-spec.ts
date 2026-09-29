import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  CONGRESS_PERSONAL_DATA_PURPOSE,
  CongressDeskRegistrationResponseSchema,
  CongressParticipantCardSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { establishAdminSession } from "../setup/admin-session.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

/**
 * 044 EARS-36 / EARS-38 — V-27 + the card half of V-28: the participant card,
 * `GET /v1/admin/events/:idOrSlug/registrations/:registrationId`.
 *
 * Driven through the REAL route on the REAL module: registrations are entered
 * at the desk route, attendance is marked through the attendance route, and
 * the card's history is therefore the 010 ledger the capture trigger wrote —
 * never a fixture of it. The two pre-migration-style rows are inserted
 * directly in the shape migration 0040's backfill left them in.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const DAY_1 = "2027-04-23";
const DAY_2 = "2027-04-24";
const CONSENT_VERSION = `2026-10-01.sha256-${"c".repeat(64)}`;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-36 — the participant card (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventA = randomUUID();
    const eventB = randomUUID();
    const slugA = `congress-card-a-${eventA.slice(0, 8)}`;
    const slugB = `congress-card-b-${eventB.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    let envBefore: Record<string, string | undefined>;
    let registrarA: { headers: Record<string, string>; sub: string };
    let registrarB: { headers: Record<string, string>; sub: string };
    let unbound: { headers: Record<string, string>; sub: string };
    let admin: { headers: Record<string, string>; sub: string };
    let specialty: { id: string; name: string };
    let ivanovaEmail: string;
    let ivanova: string;
    let twin: string;
    let solo: string;
    let otherEvent: string;
    let legacySite: string;
    let legacyPlatform: string;
    const REGISTRAR_NAME = "Регистратор Карточкина";

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

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

    async function deskEntry(
      headers: Record<string, string>,
      event: string,
      answers: { surname: string; email: string; contactPhone: string },
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${event}/registrations`,
        headers,
        payload: {
          surname: answers.surname,
          firstName: "Мария",
          patronymic: "Петровна",
          email: answers.email,
          specialtyId: specialty.id,
          workplace: "ГКБ №1",
          city: "Москва",
          region: "Московская область",
          contactPhone: answers.contactPhone,
          paperConsent: true,
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      return CongressDeskRegistrationResponseSchema.parse(res.json())
        .registrationId;
    }

    async function mark(
      headers: Record<string, string>,
      registrationId: string,
      day: string,
      present: boolean,
    ) {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/admin/events/${slugA}/registrations/${registrationId}/attendance/${day}`,
        headers,
        payload: { present },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    async function card(
      headers: Record<string, string>,
      event: string,
      registrationId: string,
    ) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/events/${event}/registrations/${registrationId}`,
        headers,
      });
    }

    async function insertEvent(id: string, slug: string, title: string) {
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline')`,
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

    /** A doctor account created outside the congress intake (the platform feed). */
    async function platformUser(
      prefix: string,
      displayName: string,
    ): Promise<string> {
      const email = uniqueEmail(prefix);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (zitadel_sub, email, display_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [`card-sub-${randomUUID()}`, email, displayName],
      );
      return rows[0]!.id;
    }

    beforeAll(async () => {
      envBefore = {
        CONGRESS_SIGNUP_EVENT_DAYS: process.env.CONGRESS_SIGNUP_EVENT_DAYS,
        CONGRESS_SIGNUP_EVENT_ID: process.env.CONGRESS_SIGNUP_EVENT_ID,
        CONGRESS_SIGNUP_CONSENT_VERSION:
          process.env.CONGRESS_SIGNUP_CONSENT_VERSION,
      };
      process.env.CONGRESS_SIGNUP_EVENT_DAYS = `${DAY_1},${DAY_2}`;
      process.env.CONGRESS_SIGNUP_EVENT_ID = eventA;
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = CONSENT_VERSION;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      const { rows: specialties } = await pool.query<{
        id: string;
        name: string;
      }>(
        "SELECT id, name FROM specialties_minzdrav WHERE is_other = false ORDER BY name LIMIT 1",
      );
      expect(specialties.length, "specialties_minzdrav must be seeded").toBe(1);
      specialty = specialties[0]!;

      await insertEvent(eventA, slugA, "Конгресс А");
      await insertEvent(eventB, slugB, "Конгресс Б");

      registrarA = await adminPrincipal("card-registrar-a", "event-registrar", eventA);
      registrarB = await adminPrincipal("card-registrar-b", "event-registrar", eventB);
      unbound = await adminPrincipal("card-registrar-none", "event-registrar");
      admin = await adminPrincipal("card-admin", "platform_admin");
      await pool.query("UPDATE users SET display_name = $2 WHERE zitadel_sub = $1", [
        registrarA.sub,
        REGISTRAR_NAME,
      ]);

      ivanovaEmail = uniqueEmail("card-ivanova");
      ivanova = await deskEntry(registrarA.headers, slugA, {
        surname: "Иванова",
        email: ivanovaEmail,
        contactPhone: "+7 (900) 111-22-33",
      });
      twin = await deskEntry(registrarA.headers, slugA, {
        surname: "Иванова-Двойник",
        email: uniqueEmail("card-twin"),
        contactPhone: "8 900 111 22 33",
      });
      solo = await deskEntry(registrarA.headers, slugA, {
        surname: "Одинокова",
        email: uniqueEmail("card-solo"),
        contactPhone: "+7 (900) 999-88-77",
      });
      otherEvent = await deskEntry(registrarB.headers, slugB, {
        surname: "Сидоров",
        email: uniqueEmail("card-other"),
        contactPhone: "+7 (900) 555-44-33",
      });

      // Pre-migration-style rows, in the shape migration 0040's backfill left
      // them: answers present → `site`, no answers → `platform` (the column
      // default).
      const siteUser = await platformUser("card-legacy-site", "Старый Сайт");
      const feedUser = await platformUser("card-legacy-feed", "Лента Платформы");
      const { rows: legacy } = await pool.query<{ id: string }>(
        `INSERT INTO registrations (user_id, event_id, answers, intake_origin)
         VALUES ($1, $3, $4::jsonb, 'site'), ($2, $3, NULL, DEFAULT)
         RETURNING id`,
        [
          siteUser,
          feedUser,
          eventA,
          JSON.stringify({
            surname: "Сайтова",
            firstName: "Ольга",
            email: "legacy-site@ds.test",
            specialtyId: specialty.id,
            workplace: "Поликлиника",
            city: "Тверь",
            region: "Тверская область",
            contactPhone: "+7 (900) 000-00-01",
            contactPhoneNormalised: "+79000000001",
          }),
        ],
      );
      legacySite = legacy[0]!.id;
      legacyPlatform = legacy[1]!.id;
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventA);
        await deleteEventFixture(pool, eventB);
      }
      if (app) await app.close();
      for (const [key, value] of Object.entries(envBefore ?? {})) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it("044 EARS-36.1: the card carries every stored answer, the registration date, origin desk, the paper consent, the mail outcome and the duplicate marker", async () => {
      const res = await card(registrarA.headers, slugA, ivanova);

      expect(res.statusCode, res.body).toBe(200);
      const body = CongressParticipantCardSchema.parse(res.json());
      expect(body).toMatchObject({
        registrationId: ivanova,
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        fullName: "Иванова Мария Петровна",
        specialtyName: specialty.name,
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Московская область",
        phone: "+7 (900) 111-22-33",
        email: ivanovaEmail,
        intakeOrigin: "desk",
        possibleDuplicate: true,
      });
      expect(Date.parse(body.registeredAt)).not.toBeNaN();
      expect(body.consents).toEqual([
        {
          purpose: CONGRESS_PERSONAL_DATA_PURPOSE,
          version: CONSENT_VERSION,
          capturedAt: expect.any(String),
          origin: "paper",
        },
      ]);
      expect(body.confirmationMail.status).toBe("sent");
      expect(body.confirmationMail.at).not.toBeNull();
    });

    it("044 EARS-36.2: the «возможный дубль» marker is the read-time derivation — a phone shared in the event marks both, a unique one marks neither", async () => {
      const twinCard = CongressParticipantCardSchema.parse(
        (await card(registrarA.headers, slugA, twin)).json(),
      );
      const soloCard = CongressParticipantCardSchema.parse(
        (await card(registrarA.headers, slugA, solo)).json(),
      );
      expect(twinCard.possibleDuplicate).toBe(true);
      expect(soloCard.possibleDuplicate).toBe(false);
    });

    it("044 EARS-36.3: every congress day is present; an unmarked day reads present null with an empty history", async () => {
      const body = CongressParticipantCardSchema.parse(
        (await card(registrarA.headers, slugA, solo)).json(),
      );
      expect(body.attendance).toEqual([
        { day: DAY_1, present: null, history: [] },
        { day: DAY_2, present: null, history: [] },
      ]);
    });

    it("044 EARS-36.4: after a registrar sets then clears 23 April, the card shows two history entries naming that registrar, in increasing time, from the 010 audit", async () => {
      await mark(registrarA.headers, ivanova, DAY_1, true);
      await mark(registrarA.headers, ivanova, DAY_1, false);

      const body = CongressParticipantCardSchema.parse(
        (await card(registrarA.headers, slugA, ivanova)).json(),
      );
      const [day1, day2] = body.attendance;
      expect(day1!.day).toBe(DAY_1);
      expect(day1!.present).toBe(false);
      expect(day1!.history).toEqual([
        {
          present: true,
          at: expect.any(String),
          actor: REGISTRAR_NAME,
          source: "admin-ui",
        },
        {
          present: false,
          at: expect.any(String),
          actor: REGISTRAR_NAME,
          source: "admin-ui",
        },
      ]);
      expect(Date.parse(day1!.history[1]!.at)).toBeGreaterThanOrEqual(
        Date.parse(day1!.history[0]!.at),
      );
      expect(day2).toEqual({ day: DAY_2, present: null, history: [] });
    });

    it("044 EARS-36.4: a registrar without a display name shows in the history as their email, not as the raw IdP sub", async () => {
      await pool.query(
        "UPDATE users SET display_name = NULL WHERE zitadel_sub = $1",
        [admin.sub],
      );
      const { rows } = await pool.query<{ email: string }>(
        "SELECT email FROM users WHERE zitadel_sub = $1",
        [admin.sub],
      );
      await mark(admin.headers, twin, DAY_2, true);

      const body = CongressParticipantCardSchema.parse(
        (await card(registrarA.headers, slugA, twin)).json(),
      );
      const day2 = body.attendance.find((d) => d.day === DAY_2)!;
      expect(day2.history).toEqual([
        {
          present: true,
          at: expect.any(String),
          actor: rows[0]!.email,
          source: "admin-ui",
        },
      ]);
    });

    it("044 EARS-36.5: pre-migration rows read back as origin site (answers present) and platform (no answers, profile fallback)", async () => {
      const site = CongressParticipantCardSchema.parse(
        (await card(admin.headers, slugA, legacySite)).json(),
      );
      const feed = CongressParticipantCardSchema.parse(
        (await card(admin.headers, slugA, legacyPlatform)).json(),
      );
      expect(site).toMatchObject({
        intakeOrigin: "site",
        surname: "Сайтова",
        firstName: "Ольга",
        patronymic: null,
        fullName: "Сайтова Ольга",
        city: "Тверь",
        phone: "+7 (900) 000-00-01",
        email: "legacy-site@ds.test",
        confirmationMail: { status: null, at: null },
      });
      expect(feed).toMatchObject({
        intakeOrigin: "platform",
        surname: null,
        firstName: null,
        fullName: "Лента Платформы",
        specialtyName: null,
        workplace: null,
        possibleDuplicate: false,
        consents: [],
      });
    });

    it("044 EARS-36.6: the card carries no field about whether the account pre-existed the registration", async () => {
      const raw = (await card(registrarA.headers, slugA, ivanova)).json() as Record<
        string,
        unknown
      >;
      expect(JSON.stringify(raw)).not.toMatch(/account_?created|pre-?exist|accountExisted/i);
      // Strict parse: any extra key is a contract failure.
      expect(CongressParticipantCardSchema.safeParse(raw).success).toBe(true);
    });

    it("044 EARS-38: a registrar bound to event A reads A's card by slug and by id", async () => {
      expect((await card(registrarA.headers, slugA, solo)).statusCode).toBe(200);
      expect((await card(registrarA.headers, eventA, solo)).statusCode).toBe(200);
    });

    it("044 EARS-38: a registrar bound to event A is refused event B's card, and B's registration id through A's path reads nothing", async () => {
      const onB = await card(registrarA.headers, slugB, otherEvent);
      expect(onB.statusCode).toBe(403);
      const throughA = await card(registrarA.headers, slugA, otherEvent);
      expect(throughA.statusCode).toBe(404);
      expect(throughA.body).not.toContain("Сидоров");
    });

    it("044 EARS-38: a registrar with no binding row is refused the card", async () => {
      expect((await card(unbound.headers, slugA, solo)).statusCode).toBe(403);
    });

    it("044 EARS-38: the platform administrator reads any event's card", async () => {
      expect((await card(admin.headers, slugA, ivanova)).statusCode).toBe(200);
      expect((await card(admin.headers, slugB, otherEvent)).statusCode).toBe(200);
    });

    it("044 EARS-36: a malformed registration id is a 400, an unknown one a 404", async () => {
      expect((await card(admin.headers, slugA, "not-a-uuid")).statusCode).toBe(400);
      expect((await card(admin.headers, slugA, randomUUID())).statusCode).toBe(404);
    });
  },
);
