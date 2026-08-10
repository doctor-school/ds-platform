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
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";

/** The 007 admin route set — the pending reference must reach none of it. */
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
  {
    method: "POST",
    url: "/v1/admin/events/00000000-0000-4000-8000-000000000000/transition",
  },
];

/**
 * 011 Verification row 3 — EARS-3: the `role → mfa_required` policy and the
 * pending-auth state.
 *
 * Two invariants carry the clause: primary auth for a policy role issues **no**
 * session, and the pending reference it issues instead reaches **nothing**. The
 * second is asserted table-driven over the whole 007 route set, because a pending
 * reference that could reach an admin route would defeat the entire spec.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-3 — role → mfa_required policy + pending-auth (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1190c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function register(email: string): Promise<string> {
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
      return rows[0]!.zitadel_sub;
    }

    async function adminLogin(email: string) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
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
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-3: a platform_admin with NO registered factor is routed to enrollment and receives no session", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");

      const res = await adminLogin(email);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: "mfa_pending_enrollment" });
      const names = res.cookies.map((c) => c.name);
      expect(names).toContain(ADMIN_PENDING_COOKIE_NAME);
      expect(names).not.toContain(ADMIN_SESSION_COOKIE_NAME);
      expect(names).not.toContain(ADMIN_CSRF_COOKIE_NAME);
      expect(names).not.toContain(SESSION_COOKIE_NAME);
    });

    it("EARS-3: a platform_admin WITH a registered factor is routed to the challenge and receives no session", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");
      fake.setTotpFactor(sub, true);

      const res = await adminLogin(email);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: "mfa_pending_challenge" });
      expect(res.cookies.map((c) => c.name)).not.toContain(
        ADMIN_SESSION_COOKIE_NAME,
      );
    });

    it("EARS-3: the pending-auth cookie is host-only, HttpOnly, Secure, SameSite=Strict and short-lived", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");

      const res = await adminLogin(email);
      const raw = (res.headers["set-cookie"] as string | string[] | undefined)!;
      const pending = (Array.isArray(raw) ? raw : [raw]).find((c) =>
        c.startsWith(`${ADMIN_PENDING_COOKIE_NAME}=`),
      )!;

      expect(pending).toContain("Path=/");
      expect(pending).toContain("HttpOnly");
      expect(pending).toContain("Secure");
      expect(pending).toContain("SameSite=Strict");
      expect(pending).not.toContain("Domain");
      // Minutes, not hours (design §3) — the window a proof-of-check waits in.
      const maxAge = Number(/Max-Age=(\d+)/.exec(pending)![1]);
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(15 * 60);
    });

    it("EARS-3: the pending-auth reference reaches NO admin route, over the whole 007 route set", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");

      const login = await adminLogin(email);
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;

      for (const route of ADMIN_ROUTES) {
        const res = await app.inject({
          method: route.method as "GET",
          url: route.url,
          headers: {
            ...ADMIN_DEVICE,
            cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}`,
          },
        });
        expect(
          res.statusCode,
          `${route.method} ${route.url} must refuse a pending-auth reference`,
        ).toBe(401);
      }
    });

    it("EARS-3: a pending reference presented as an admin session cookie authenticates nothing", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");

      const login = await adminLogin(email);
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;

      // The pending record lives in its own key namespace behind its own port,
      // so replaying the reference as a `sid` resolves nothing (design §8: two
      // record kinds, not one flag).
      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${ref}`,
        },
      });
      expect(res.statusCode).toBe(401);
      expect(await app.get(AdminSessionService).getBySid(ref)).toBeUndefined();
    });

    it("EARS-3: a refused pending reference on an admin route appends an auth.session.rejected row with reason pending_ref", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");

      const login = await adminLogin(email);
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;

      const before = await pool.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM audit_ledger WHERE event_type = 'auth.session.rejected' AND reason = 'pending_ref'",
      );
      await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}`,
        },
      });
      const after = await pool.query<{ n: string; metadata: unknown }>(
        "SELECT COUNT(*)::text AS n FROM audit_ledger WHERE event_type = 'auth.session.rejected' AND reason = 'pending_ref'",
      );

      expect(Number(after.rows[0]!.n)).toBeGreaterThan(
        Number(before.rows[0]!.n),
      );
    });

    it("EARS-3: a principal the policy does not cover is refused at the admin origin", async () => {
      const email = uniqueEmail();
      // Registered ⇒ `doctor_guest` only; no policy role.
      await register(email);

      const res = await adminLogin(email);

      // The same generic 401 a wrong password yields — nothing here discloses
      // whether the account exists or which roles it holds (ADR-0001 §7).
      expect(res.statusCode).toBe(401);
      expect(res.cookies.map((c) => c.name)).not.toContain(
        ADMIN_PENDING_COOKIE_NAME,
      );
    });

    it("EARS-3: the non-policy refusal is recorded honestly — reason not_permitted, keyed by the subject", async () => {
      const email = uniqueEmail();
      const sub = await register(email);

      await adminLogin(email);

      const { rows } = await pool.query<{
        event_type: string;
        reason: string | null;
        metadata: { tier?: string };
      }>(
        `SELECT event_type, reason, metadata FROM audit_ledger
          WHERE subject_id = $1 AND event_type = 'auth.login.failure'
          ORDER BY created_at DESC LIMIT 1`,
        [sub],
      );
      // Valid credentials at the admin origin from a principal the policy does
      // not cover is the sharpest signal this surface produces — recorded as
      // itself, keyed by the subject the IdP asserted, instead of collapsing
      // into the anonymous `no_user` of an unknown identifier. Audit-only: the
      // response above is the same uniform 401 every refusal branch returns.
      expect(rows[0]).toBeDefined();
      expect(rows[0]!.reason).toBe("not_permitted");
      expect(rows[0]!.metadata).toMatchObject({ tier: "admin" });
    });

    it("EARS-3: primary auth at the admin origin appends auth.login.success carrying tier: admin", async () => {
      const email = uniqueEmail();
      const sub = await register(email);
      await fake.grantProjectRole(sub, "platform_admin");

      await adminLogin(email);

      const { rows } = await pool.query<{
        event_type: string;
        metadata: { tier?: string; method?: string };
      }>(
        `SELECT event_type, metadata FROM audit_ledger
          WHERE subject_id = $1 AND event_type = 'auth.login.success'
          ORDER BY created_at DESC LIMIT 1`,
        [sub],
      );
      expect(rows[0]).toBeDefined();
      // Canonical §7.3 id shared with 003's portal login — the tier field is the
      // whole of the difference (design §8a); no `admin_*` class was minted.
      expect(rows[0]!.event_type).toBe("auth.login.success");
      expect(rows[0]!.metadata).toMatchObject({
        tier: "admin",
        method: "password",
      });
    });
  },
);
