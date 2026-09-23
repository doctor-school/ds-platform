import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { CongressRosterListSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  computeFingerprint,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session/session.cookie.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import {
  ADMIN_SESSION_STORE,
  type AdminSessionRecord,
  type AdminSessionStore,
} from "../../src/auth/admin-session/admin-session.types.js";
import { CONGRESS_SIGN_UP_CLOCK } from "../../src/congress/congress-signup.tokens.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { establishAdminSession } from "../setup/admin-session.js";
import { UserMirrorService } from "../../src/auth/user-mirror.service.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

/**
 * 044 EARS-18 — V-11. The HTTP route over the roster read model:
 * `GET /v1/admin/events/:idOrSlug/roster`, reachable by the `event-registrar`
 * and by the `platform_admin`, refused to every other principal, answering a
 * schema-valid page whose rows carry the answers the registrar reads at the desk.
 *
 * What is driven here is the REAL route on the REAL module: the rows are created
 * through the REAL public congress intake, so the row projection is checked
 * against the shape the production writer actually produces, not a hand-inserted
 * one.
 *
 * **The registrar's session is the real one.** Since 044 EARS-19 (#2312) the MFA
 * policy covers `event-registrar`, so `startLogin` admits it and the registrar
 * here logs in over the real admin arc — the same `establishAdminSession` helper
 * the `platform_admin` cases use. The only session still minted through
 * `ADMIN_SESSION_STORE` is the EARS-18.3 NEGATIVE one: a principal holding
 * neither role is refused by `startLogin` by design, so there is no HTTP path
 * that could produce it, and the 403 must nevertheless be proven against an
 * admin-tier credential rather than against no credential at all.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const CONSENT_VERSION = `2026-10-01.sha256-${"c".repeat(64)}`;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 EARS-18 — the roster HTTP route (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let sessions: AdminSessionStore;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const eventId = randomUUID();
    const eventSlug = `congress-roster-${eventId.slice(0, 8)}`;
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    /** Inside the EARS-28 registration window for every test here. */
    const now = new Date("2026-11-01T10:00:00.000+03:00");
    let specialty: { id: string; name: string };
    /** The EARS-16 platform-origin registration: profile values, no answers. */
    let platformRow: { displayName: string; email: string; phone: string };

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** One public congress intake — the production writer of a roster row. */
    async function signUp(
      surname: string,
      email: string,
      contactPhone: string,
      place: { workplace: string; city: string; region: string },
    ): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/congress/sign-up",
        payload: {
          surname,
          firstName: "Мария",
          patronymic: "Петровна",
          email,
          specialtyId: specialty.id,
          workplace: place.workplace,
          city: place.city,
          region: place.region,
          contactPhone,
          personalDataConsent: true,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    /**
     * An admin-tier session for a principal holding exactly `roles` — used ONLY
     * for the EARS-18.3 negative case, whose principal `startLogin` refuses by
     * design (see the suite note). Every positive case logs in for real.
     */
    async function adminTierSession(roles: string[]): Promise<string> {
      const record: AdminSessionRecord = {
        sid: randomUUID(),
        zitadelSessionId: `zit-${randomUUID()}`,
        sub: `sub-${randomUUID()}`,
        identifier: uniqueEmail("tier"),
        roles,
        mfa: true,
        fingerprint: computeFingerprint({
          userAgent: device["user-agent"],
          ip: "127.0.0.1",
          acceptLanguage: device["accept-language"],
        }),
        csrfToken: randomUUID(),
        expiresAtMs: Date.now() + 60_000,
      };
      await sessions.create(record);
      return `${ADMIN_SESSION_COOKIE_NAME}=${record.sid}; ${ADMIN_CSRF_COOKIE_NAME}=${record.csrfToken}`;
    }

    /** Register + login a doctor_guest; returns the PORTAL session cookie value. */
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

    /** A registered `platform_admin` holding a real admin session (011 EARS-1). */
    async function platformAdminCookie(): Promise<string> {
      const email = uniqueEmail("admin");
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
      expect(rows[0]).toBeDefined();
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.cookieHeader;
    }

    /**
     * A registered `event-registrar` holding a REAL admin session: primary auth
     * at the admin origin, then the second factor — the arc 044 EARS-19 opened
     * to the role. No store seam.
     */
    let registrarCookieCache: string | undefined;
    async function registrarCookie(): Promise<string> {
      if (registrarCookieCache) return registrarCookieCache;
      const email = uniqueEmail("registrar");
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
      expect(rows[0]).toBeDefined();
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "event-registrar");
      const registrar = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      registrarCookieCache = registrar.cookieHeader;
      return registrarCookieCache;
    }

    /** One roster page read by the registrar, parsed against the contract. */
    async function search(q: string) {
      const cookie = await registrarCookie();
      const res = await roster(
        cookie,
        `/v1/admin/events/${eventSlug}/roster?q=${encodeURIComponent(q)}`,
      );
      expect(res.statusCode, `q=${q}`).toBe(200);
      return CongressRosterListSchema.parse(res.json());
    }

    /**
     * 044 EARS-16 — the OTHER production writer of a roster row: a signed-in
     * doctor registering through the existing platform path. It stores no
     * answers, so every cell the roster renders for this row has to come from
     * the account mirror.
     *
     * The display name is set over its own real route; `users.phone` has no
     * self-service writer at all (it is mirrored from the IdP), so it is written
     * through `UserMirrorService.upsert` — the production writer itself, entered
     * one hop past the IdP that would otherwise supply the number.
     */
    async function registerThroughPlatform(): Promise<{
      displayName: string;
      email: string;
      phone: string;
    }> {
      const email = uniqueEmail("platform");
      const sid = await doctorSession(email);
      const headers = {
        ...device,
        cookie: `${SESSION_COOKIE_NAME}=${sid}`,
      };

      const displayName = "Сидорова Анна Ивановна";
      const named = await app.inject({
        method: "PUT",
        url: "/v1/me/display-name",
        headers,
        payload: { displayName },
      });
      expect(named.statusCode).toBe(200);

      // E.164-valid and random, so parallel suites on the shared dev-stand DB
      // do not collide on the unique phone constraint.
      const phone = `+1999${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]).toBeDefined();
      await app
        .get(UserMirrorService)
        .upsert({ zitadelSub: rows[0]!.zitadel_sub, phone });

      const registered = await app.inject({
        method: "POST",
        url: `/v1/events/${eventSlug}/registration`,
        headers,
      });
      expect(registered.statusCode).toBe(200);
      return { displayName, email, phone };
    }

    async function roster(
      cookieHeader: string,
      path: string,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({
        method: "GET",
        url: path,
        headers: { ...device, cookie: cookieHeader },
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
      sessions = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);

      // EARS-25: the roster resolves the specialty NAME through the Minzdrav
      // table, so the fixture answers must carry an id that exists in it.
      const specialties = await pool.query<{ id: string; name: string }>(
        "SELECT id, name FROM specialties_minzdrav ORDER BY name LIMIT 1",
      );
      expect(
        specialties.rows[0],
        "specialties_minzdrav must be seeded (017)",
      ).toBeDefined();
      specialty = specialties.rows[0]!;

      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline')`,
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

      await signUp("Иванова", uniqueEmail("roster-a"), "+7 (900) 111-22-33", {
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Москва",
      });
      await signUp("Петрова", uniqueEmail("roster-b"), "+7 (900) 444-55-66", {
        workplace: "Городская больница №7",
        city: "Казань",
        region: "Татарстан",
      });
      // EARS-16 — the third row is written by the OTHER production writer: a
      // signed-in doctor registering through the platform path, which stores no
      // answers at all. Its cells must come from the account.
      platformRow = await registerThroughPlatform();
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        await deleteEventFixture(pool, eventId);
      }
      if (app) await app.close();
    });

    it("044 EARS-18: a registrar principal reaches the roster route and reads a schema-valid page of the desk answers", async () => {
      const cookie = await registrarCookie();

      const res = await roster(cookie, `/v1/admin/events/${eventSlug}/roster`);
      expect(res.statusCode).toBe(200);

      const body = CongressRosterListSchema.parse(res.json());
      // The contract round-trips: no extra key the schema does not declare.
      expect(body).toEqual(CongressRosterListSchema.parse(res.json()));

      expect(body.event.id).toBe(eventId);
      expect(body.event.slug).toBe(eventSlug);
      // Two congress-intake rows + the EARS-16 platform-origin one.
      expect(body.total).toBe(3);
      expect(body.items).toHaveLength(3);
      expect(body.page).toBe(1);

      // The answers the registrar identifies a person by — each cell carried
      // from the intake payload, the specialty resolved to its NAME (EARS-25).
      const names = body.items.map((r) => r.fullName);
      expect(names).toContain("Иванова Мария Петровна");
      expect(names).toContain("Петрова Мария Петровна");
      const row = body.items[0]!;
      expect(row.specialtyName).toBe(specialty.name);
      expect(row.workplace).toBe("ГКБ №1");
      expect(row.city).toBe("Москва");
      expect(row.region).toBe("Москва");
      // EARS-29: the phone renders exactly as it was typed, not normalised.
      expect(row.phone).toMatch(/^\+7 \(900\) /);
      expect(row.email).toContain("@ds.test");
    });

    it("044 EARS-18.2: the same route is reachable by a platform_admin, and it pages", async () => {
      const cookie = await platformAdminCookie();

      const first = await roster(
        cookie,
        `/v1/admin/events/${eventId}/roster?page=1&pageSize=1`,
      );
      expect(first.statusCode).toBe(200);
      const firstPage = CongressRosterListSchema.parse(first.json());
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.pageSize).toBe(1);
      // `total` is the denominator over the WHOLE event, never the page.
      expect(firstPage.total).toBe(3);

      const second = await roster(
        cookie,
        `/v1/admin/events/${eventId}/roster?page=2&pageSize=1`,
      );
      expect(second.statusCode).toBe(200);
      const secondPage = CongressRosterListSchema.parse(second.json());
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.page).toBe(2);
      expect(secondPage.items[0]!.registrationId).not.toBe(
        firstPage.items[0]!.registrationId,
      );
    });

    it("044 EARS-18.3: a principal without the registrar or administrator role is refused the roster", async () => {
      // An authenticated admin-tier principal that simply lacks the role: the
      // refusal is authorization (403), not a missing session.
      const cookie = await adminTierSession(["doctor_guest"]);
      const res = await roster(cookie, `/v1/admin/events/${eventSlug}/roster`);
      expect(res.statusCode).toBe(403);

      // And a doctor's PORTAL session is not an admin credential at all
      // (011 EARS-2): it never even resolves to a subject on this route.
      const portal = await doctorSession(uniqueEmail("doctor"));
      const asDoctor = await roster(
        `${SESSION_COOKIE_NAME}=${portal}`,
        `/v1/admin/events/${eventSlug}/roster`,
      );
      expect(asDoctor.statusCode).toBe(401);
    });

    it("044 EARS-18.5: the instant search matches the ФИО cell", async () => {
      const page = await search("Иванова");
      expect(page.total).toBe(1);
      expect(page.items[0]!.fullName).toBe("Иванова Мария Петровна");
    });

    it("044 EARS-18.5.1: …the место работы cell", async () => {
      const page = await search("Городская больница");
      expect(page.total).toBe(1);
      expect(page.items[0]!.workplace).toBe("Городская больница №7");
    });

    it("044 EARS-18.5.2: …the город and область cells", async () => {
      const byCity = await search("Казань");
      expect(byCity.total).toBe(1);
      expect(byCity.items[0]!.city).toBe("Казань");

      const byRegion = await search("Татарстан");
      expect(byRegion.total).toBe(1);
      expect(byRegion.items[0]!.region).toBe("Татарстан");
    });

    it("044 EARS-18.5.3: …the email cell", async () => {
      const page = await search(platformRow.email);
      expect(page.total).toBe(1);
      expect(page.items[0]!.email).toBe(platformRow.email);
    });

    it("044 EARS-18.5.4: …the специальность name, which is a JOINed cell rather than an answer", async () => {
      const page = await search(specialty.name);
      // Both congress-intake rows carry the specialty; the platform-origin row
      // has no answers and therefore no specialty at all.
      expect(page.total).toBe(2);
      for (const row of page.items)
        expect(row.specialtyName).toBe(specialty.name);
    });

    it("044 EARS-18.5.5: …the телефон cell as the participant typed it", async () => {
      const page = await search("444-55-66");
      expect(page.total).toBe(1);
      expect(page.items[0]!.phone).toBe("+7 (900) 444-55-66");
    });

    it("044 EARS-18.5.6: EARS-29 — a digits-only term in the OTHER domestic form finds the formatted number", async () => {
      // `8 900 444 55 66` and `+7 (900) 444-55-66` are the same number to a
      // registrar and nothing alike as text: the match is the normalised value
      // stored beside the typed one, never the rendered cell.
      const page = await search("89004445566");
      expect(page.total).toBe(1);
      expect(page.items[0]!.phone).toBe("+7 (900) 444-55-66");
    });

    it("044 EARS-18.5.7: a term matching nobody is an empty page of the same event, not a 404 and not the whole roster", async () => {
      const page = await search("Такогочеловеканет");
      expect(page.total).toBe(0);
      expect(page.items).toEqual([]);
      expect(page.event.id).toBe(eventId);
    });

    it("044 EARS-18.5.8: a wildcard typed into the search box is a literal character, not a wildcard", async () => {
      // The escaping claim: `%` and `_` from the caller must match themselves.
      // Unescaped, `%` would match every row of the event and `_` every row
      // with at least one character in the blob — the whole roster, both times.
      for (const term of ["%", "_", "%%"]) {
        const page = await search(term);
        expect(page.total, `q=${term}`).toBe(0);
      }
    });

    it("044 EARS-18.9: EARS-16 — a platform-origin registration renders the account's own profile values, and an empty cell where it has none", async () => {
      const cookie = await registrarCookie();
      const res = await roster(cookie, `/v1/admin/events/${eventSlug}/roster`);
      expect(res.statusCode).toBe(200);
      const page = CongressRosterListSchema.parse(res.json());

      const row = page.items.find((r) => r.email === platformRow.email);
      expect(row, "the platform-origin registration must be on the roster").toBeDefined();

      // Read from `users`, because this registration carries NO answers at all.
      expect(row!.fullName).toBe(platformRow.displayName);
      expect(row!.email).toBe(platformRow.email);
      expect(row!.phone).toBe(platformRow.phone);

      // …and what the account does not hold stays EMPTY — null on the wire, an
      // empty cell on the screen, never a placeholder.
      expect(row!.specialtyName).toBeNull();
      expect(row!.workplace).toBeNull();
      expect(row!.city).toBeNull();
      expect(row!.region).toBeNull();
      // No congress confirmation letter is sent down the platform path.
      expect(row!.confirmationMailStatus).toBeNull();

      // The answers column really is absent — the fallback is being exercised,
      // not an answers payload that happens to agree with the account.
      const { rows } = await pool.query<{ answers: unknown }>(
        `SELECT r.answers FROM registrations r
           JOIN users u ON u.id = r.user_id
          WHERE u.email = $1 AND r.event_id = $2`,
        [platformRow.email, eventId],
      );
      expect(rows[0]).toBeDefined();
      expect(rows[0]!.answers).toBeNull();
    });

    it("044 EARS-18.4: an unknown event is a 404, never an empty roster page", async () => {
      const cookie = await registrarCookie();
      const res = await roster(
        cookie,
        `/v1/admin/events/no-such-congress-${randomUUID().slice(0, 8)}/roster`,
      );
      expect(res.statusCode).toBe(404);
    });
  },
);
