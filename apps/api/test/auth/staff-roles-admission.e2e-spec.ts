import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { totpCode } from "../../src/auth/idp/totp.js";
import { DoctorEventsRepository } from "../../src/storefront/doctor-events.repository.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 049 EARS-1, EARS-2 — V-2. A broadcast-director-only account and a
 * superadministrator (`superadmin` + `platform_admin`, the 049 invariant) each
 * take the staff second-factor flow at the admin origin — TOTP enrolment, the
 * session read with their role in `roles`, sign-out — and a director is a staff
 * account, never a participant in a participant count.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "049 EARS-1, EARS-2 — superadmin and broadcast director admission (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const password = "Aa1!ufficiently-long-pw";
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEvents: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `ears049-${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /**
     * Register a principal holding exactly `roles` at the IdP. The
     * registration cascade grants `doctor_guest`; revoking it makes the account
     * hold the staff roles only, so admission cannot pass on the visitor role.
     */
    async function registerStaff(
      prefix: string,
      roles: readonly string[],
    ): Promise<{ email: string; sub: string }> {
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
      await fake.revokeProjectRole(sub, "doctor_guest");
      for (const role of roles) await fake.grantProjectRole(sub, role);
      expect([...fake.grantedRoles(sub)].sort()).toEqual([...roles].sort());
      return { email, sub };
    }

    /**
     * The whole admin arc of EARS-1: primary auth answers the enrolment step,
     * TOTP enrolment mints the session, the session read returns the roles,
     * sign-out ends it. Returns the roles the session read answered.
     */
    async function signInEnrolReadSignOut(
      email: string,
      sub: string,
    ): Promise<string[]> {
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toEqual({ state: "mfa_pending_enrollment" });
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      const pendingHeaders = {
        ...ADMIN_DEVICE,
        cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}`,
      };

      const start = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/start",
        headers: pendingHeaders,
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const secret = (start.json() as { secret: string }).secret;

      const verify = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/verify",
        headers: pendingHeaders,
        payload: { code: totpCode(secret) },
      });
      expect(verify.statusCode).toBe(200);
      expect(await fake.hasTotpFactor(sub)).toBe(true);
      const sid = verify.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      )!.value;
      const csrf = verify.cookies.find(
        (c) => c.name === ADMIN_CSRF_COOKIE_NAME,
      )!.value;
      const sessionHeaders = {
        ...ADMIN_DEVICE,
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
        [ADMIN_CSRF_HEADER]: csrf,
      };

      const session = await app.inject({
        method: "GET",
        url: "/v1/admin/auth/session",
        headers: sessionHeaders,
      });
      expect(session.statusCode).toBe(200);
      const { roles } = session.json() as { roles: string[] };

      const logout = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/logout",
        headers: sessionHeaders,
      });
      expect(logout.statusCode).toBe(200);

      const after = await app.inject({
        method: "GET",
        url: "/v1/admin/auth/session",
        headers: sessionHeaders,
      });
      expect([401, 403]).toContain(after.statusCode);
      return roles;
    }

    async function insertEvent(): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ${eventClassificationSql()})`,
        [
          id,
          `ears049-${id.slice(0, 8)}`,
          "Эфир для участников",
          "Кардиология сегодня",
          "2026-12-17T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          "published",
        ],
      );
      createdEvents.push(id);
      return id;
    }

    async function userIdOf(email: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return rows[0]!.id;
    }

    beforeAll(async () => {
      // Bound here, never read back off the container: `IdpModule` picks the
      // real adapter whenever a dev-stand configures `IDP_ISSUER`, and the
      // test-only grant accessors do not exist on it.
      fake = new FakeIdpClient();
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
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    }, 60_000);

    afterEach(async () => {
      for (const id of createdEvents.splice(0))
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("049 EARS-1: a director-only account signs in, enrols TOTP, reads broadcast_director in its session and signs out", async () => {
      const { email, sub } = await registerStaff("director", [
        "broadcast_director",
      ]);

      const roles = await signInEnrolReadSignOut(email, sub);

      expect(roles).toEqual(["broadcast_director"]);
    }, 30_000);

    it("049 EARS-1: a superadministrator (superadmin + platform_admin) signs in, enrols TOTP, reads both roles in its session and signs out", async () => {
      const { email, sub } = await registerStaff("superadmin", [
        "superadmin",
        "platform_admin",
      ]);

      const roles = await signInEnrolReadSignOut(email, sub);

      expect([...roles].sort()).toEqual(["platform_admin", "superadmin"]);
      // The mirror records the superadministrator first (EARS-2).
      const { rows } = await pool.query<{ role: string }>(
        "SELECT role FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]!.role).toBe("superadmin");
    }, 30_000);

    it("049 EARS-2: a director signed up for an event is not counted as a participant", async () => {
      const director = await registerStaff("director-count", [
        "broadcast_director",
      ]);
      // The admin session keeps the `users.role` mirror in step with the claim.
      await signInEnrolReadSignOut(director.email, director.sub);
      const { rows } = await pool.query<{ role: string }>(
        "SELECT role FROM users WHERE email = $1",
        [director.email],
      );
      expect(rows[0]!.role).toBe("broadcast_director");

      const doctorEmail = uniqueEmail("doctor");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: doctorEmail, password, consent },
      });
      expect(reg.statusCode).toBe(200);

      const eventId = await insertEvent();
      for (const email of [director.email, doctorEmail]) {
        await pool.query(
          "INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)",
          [await userIdOf(email), eventId],
        );
      }

      const counts = await app
        .get(DoctorEventsRepository)
        .countSignUps([eventId]);
      expect(counts.get(eventId)).toBe(1);
    }, 30_000);
  },
);
