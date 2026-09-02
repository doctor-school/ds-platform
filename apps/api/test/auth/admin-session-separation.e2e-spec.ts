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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import {
  ADMIN_DEVICE,
  establishAdminSession,
  type AdminSessionHandle,
} from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * The full 007 admin route set (the generated endpoint-authz matrix is the
 * source). EARS-2's separation claim is only worth something if it holds over
 * **every** admin route, not the one a test happened to pick — a single route
 * left on the portal cookie is the whole vulnerability.
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
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/hide",
  },
  {
    method: "POST",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/transition",
  },
];

/**
 * 011 Verification row 2 — EARS-2: the two cookies are held apart by CODE.
 *
 * The admin app reaches `/v1/*` same-origin through its proxy, so a browser
 * holding a doctor-portal session **will** attach `__Host-ds_session` on an admin
 * route. "It happens not to work" is not a control; the refusal has to be
 * explicit and auditable. This suite asserts that refusal over the whole 007
 * route set, the symmetric refusal on a portal route, and the scoping of admin
 * logout.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-2 — admin/portal cookie separation (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1190b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
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

    /** A live doctor-portal session for the same principal (the borrowed-cookie case). */
    async function portalSession(email: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    }

    async function rejectionRows(
      sub: string,
    ): Promise<
      Array<{ event_type: string; reason: string | null; metadata: unknown }>
    > {
      const { rows } = await pool.query<{
        event_type: string;
        reason: string | null;
        metadata: unknown;
      }>(
        `SELECT event_type, reason, metadata FROM audit_ledger
          WHERE event_type = 'auth.session.rejected'
            AND (subject_id = $1 OR subject_id IS NULL)
          ORDER BY created_at DESC`,
        [sub],
      );
      return rows;
    }

    beforeAll(async () => {
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
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-2: a portal session cookie authenticates NO admin route, over the whole 007 route set", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const portal = await portalSession(email);

      for (const route of ADMIN_ROUTES) {
        const res = await app.inject({
          method: route.method as "GET",
          url: route.url,
          headers: {
            ...ADMIN_DEVICE,
            cookie: `${SESSION_COOKIE_NAME}=${portal}`,
          },
        });
        // 401 — unauthenticated. Never 200, and never a 403 "insufficient role"
        // (which would mean the portal cookie authenticated and only the role
        // check refused it).
        expect(
          res.statusCode,
          `${route.method} ${route.url} must refuse the portal cookie`,
        ).toBe(401);
      }
    });

    it("EARS-2: a refused portal cookie on an admin route appends an auth.session.rejected row", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      const portal = await portalSession(email);
      const before = (await rejectionRows(sub)).length;

      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${SESSION_COOKIE_NAME}=${portal}`,
        },
      });
      expect(res.statusCode).toBe(401);

      const rows = await rejectionRows(sub);
      expect(rows.length).toBeGreaterThan(before);
      const latest = rows[0]!;
      // Canonical §7.3 wire id, with the tier discriminator that keeps admin
      // rows separable from the portal's on the shared auth.session.* class.
      expect(latest.event_type).toBe("auth.session.rejected");
      expect(latest.reason).toBe("wrong_cookie");
      expect(latest.metadata).toMatchObject({ tier: "admin" });
    });

    it("EARS-2: a portal cookie at the admin LOGOUT route is refused with a row — the auth-entry exemption does not cover it", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      const portal = await portalSession(email);
      const before = (await rejectionRows(sub)).length;

      // `/v1/admin/auth/logout` shares the `/v1/admin/auth/` prefix with the
      // public login route, but it is an `access: authenticated` admin route —
      // a foreign cookie here is a refused admin request, not a caller who has
      // simply not logged in yet, so it owes the EARS-2 row like any other.
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/logout",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${SESSION_COOKIE_NAME}=${portal}`,
        },
      });
      expect(res.statusCode).toBe(401);

      const rows = await rejectionRows(sub);
      expect(rows.length).toBeGreaterThan(before);
      const latest = rows[0]!;
      expect(latest.event_type).toBe("auth.session.rejected");
      expect(latest.reason).toBe("wrong_cookie");
      expect(latest.metadata).toMatchObject({ tier: "admin" });
    });

    it("EARS-2: an admin session cookie authenticates NO portal route", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin: AdminSessionHandle = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      // The portal's session-self read is the sharpest probe: it accepts
      // `platform_admin` (#1038), so a refusal here can only be the cookie tier.
      const res = await app.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${admin.sid}`,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("EARS-2: with BOTH cookies present, an admin route resolves the admin principal only", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const portal = await portalSession(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...admin.headers,
          cookie: `${SESSION_COOKIE_NAME}=${portal}; ${admin.cookieHeader}`,
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it("EARS-2: admin logout clears only the admin cookies and leaves a concurrent portal session valid", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const portal = await portalSession(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      const out = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/logout",
        headers: {
          ...admin.headers,
          cookie: `${SESSION_COOKIE_NAME}=${portal}; ${admin.cookieHeader}`,
        },
      });
      expect(out.statusCode).toBe(200);
      expect(out.json()).toEqual({ status: "logged_out" });

      const cleared = out.cookies.map((c) => c.name);
      expect(cleared).toContain(ADMIN_SESSION_COOKIE_NAME);
      expect(cleared).toContain(ADMIN_CSRF_COOKIE_NAME);
      // The portal cookie is NOT in the clearing set — admin logout is scoped.
      expect(cleared).not.toContain(SESSION_COOKIE_NAME);

      // The admin session is gone…
      const afterAdmin = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: admin.headers,
      });
      expect(afterAdmin.statusCode).toBe(401);

      // …and the concurrent portal session still works.
      const afterPortal = await app.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${SESSION_COOKIE_NAME}=${portal}`,
        },
      });
      expect(afterPortal.statusCode).toBe(200);
    });
  },
);
