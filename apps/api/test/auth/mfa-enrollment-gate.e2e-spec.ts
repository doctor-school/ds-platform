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
import { RATE_LIMIT_THRESHOLDS, RELAXED_RATE_LIMIT } from "../setup/rate-limit.js";
import {
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE, establishAdminSession } from "../setup/admin-session.js";

/**
 * The full 007 admin route set — the surface EARS-4 says a `mfa_pending_enrollment`
 * principal reaches **none** of. A single route left reachable on a pending
 * reference is the whole gate, so the claim is asserted over every row rather
 * than the one a test happened to pick.
 */
const ADMIN_ROUTES: ReadonlyArray<{ method: string; url: string }> = [
  { method: "GET", url: "/v1/admin/events" },
  {
    method: "GET",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000",
  },
  { method: "POST", url: "/v1/admin/events" },
  {
    method: "PATCH",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000",
  },
  {
    method: "PUT",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/stream",
  },
  {
    method: "POST",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/publish",
  },
  {
    method: "POST",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/open",
  },
  {
    method: "POST",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/close",
  },
  {
    method: "POST",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/archive",
  },
  { method: "POST", url: "/v1/admin/auth/logout" },
];

/** The two endpoints the `mfa_pending_enrollment` state admits — and nothing else. */
const ENROLLMENT_ROUTES = {
  start: "/v1/admin/auth/mfa/enroll/start",
  verify: "/v1/admin/auth/mfa/enroll/verify",
} as const;

/**
 * 011 Verification row 4 — EARS-4: the forced-enrollment gate.
 *
 * The gate lives in the **API**, not in the admin app's routing: hiding
 * navigation is necessary but never sufficient, so a direct request carrying a
 * pending reference must be refused server-side on every admin route (design §3).
 * This suite is the server half of Verification row 4; the browser half lives in
 * `apps/admin/e2e/mfa-enrollment.spec.ts`.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-4 — forced-enrollment gate (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";

    /**
     * Every principal this suite registers, dropped in `afterEach`. The fake IdP
     * numbers its subjects from a per-app counter, so a `users` row surviving a
     * previous run collides with the next run's `zitadel_sub` and the cascade
     * silently updates the stale row instead of inserting the new one — cleanup
     * is what keeps a re-run deterministic against a shared branch database.
     */
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1191gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Register, grant `platform_admin`, and return the IdP subject. */
    async function registerAdmin(email: string): Promise<string> {
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
      await fake.grantProjectRole(sub, "platform_admin");
      return sub;
    }

    /** Primary auth for a factor-less admin → the pending reference EARS-3 issues. */
    async function pendingRef(email: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: "mfa_pending_enrollment" });
      return res.cookies.find((c) => c.name === ADMIN_PENDING_COOKIE_NAME)!
        .value;
    }

    function pendingHeaders(ref: string): Record<string, string> {
      return { ...ADMIN_DEVICE, cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}` };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
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
      fake = app.get<FakeIdpClient>(IDP_CLIENT);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-4: a pending-enrollment reference reaches NO admin route", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const ref = await pendingRef(email);

      for (const route of ADMIN_ROUTES) {
        const res = await app.inject({
          method: route.method as "GET",
          url: route.url,
          headers: pendingHeaders(ref),
          payload: route.method === "GET" ? undefined : {},
        });
        expect(
          res.statusCode,
          `${route.method} ${route.url} must refuse a pending reference`,
        ).toBe(401);
        expect(res.body).not.toContain("events");
      }
    });

    it("EARS-4: every refused admin route appends an auth.session.rejected row with reason pending_ref", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      const ref = await pendingRef(email);

      const before = await rejectionCount();
      await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: pendingHeaders(ref),
      });
      const rows = await pool.query<{ reason: string | null }>(
        "SELECT reason FROM audit_ledger WHERE event_type = 'auth.session.rejected' ORDER BY created_at DESC LIMIT 1",
      );
      expect(await rejectionCount()).toBe(before + 1);
      expect(rows.rows[0]!.reason).toBe("pending_ref");
      expect(sub).toBeTruthy();
    });

    it("EARS-4: the enrollment endpoints ARE reachable on a pending-enrollment reference", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const ref = await pendingRef(email);

      const start = await app.inject({
        method: "POST",
        url: ENROLLMENT_ROUTES.start,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);

      // A wrong code is a 401, not a 404/403 — the ROUTE is admitted, the code is not.
      const verify = await app.inject({
        method: "POST",
        url: ENROLLMENT_ROUTES.verify,
        headers: pendingHeaders(ref),
        payload: { code: "000000" },
      });
      expect(verify.statusCode).toBe(401);
    });

    it("EARS-4: the enrollment endpoints refuse a caller holding NO pending reference", async () => {
      for (const url of Object.values(ENROLLMENT_ROUTES)) {
        const res = await app.inject({
          method: "POST",
          url,
          headers: ADMIN_DEVICE,
          payload: { code: "000000" },
        });
        expect(res.statusCode, `${url} without a pending reference`).toBe(401);
      }
    });

    it("EARS-4: the gate is not bypassable by presenting an established admin session instead", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      fake.setTotpFactor(sub, true);
      const session = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      // An admin session is NOT a pending authentication: the enrollment
      // endpoints exist only for the pending state and refuse everything else.
      for (const url of Object.values(ENROLLMENT_ROUTES)) {
        const res = await app.inject({
          method: "POST",
          url,
          headers: {
            ...ADMIN_DEVICE,
            cookie: `${ADMIN_SESSION_COOKIE_NAME}=${session.sid}`,
          },
          payload: { code: "000000" },
        });
        expect(res.statusCode, `${url} with an admin session`).toBe(401);
      }
    });

    async function rejectionCount(): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_ledger WHERE event_type = 'auth.session.rejected'",
      );
      return Number(rows[0]!.n);
    }
  },
);
