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
import {
  computeFingerprint,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session/session.cookie.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * 011 Verification row 1 — EARS-1: the dedicated `__Host-ds_admin_session`.
 *
 * The assertions are made against the API and the issued cookie material
 * directly, never through the UI (011 design §10): the cookie's attribute set is
 * the security control, so the test reads the attributes rather than trusting a
 * browser to enforce them.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-1 — dedicated __Host-ds_admin_session issuance (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1190a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Register a principal and grant it `platform_admin` (the policy role). */
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

    it("EARS-1: the issued admin cookie is host-only, Path=/, HttpOnly, Secure, SameSite=Strict — and carries no Domain", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);

      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      const pendingRef = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;

      const fingerprint = computeFingerprint({
        userAgent: ADMIN_DEVICE["user-agent"],
        ip: "127.0.0.1",
        acceptLanguage: ADMIN_DEVICE["accept-language"],
      });
      const upgraded = await app
        .get(AdminSessionService)
        .upgradePending(pendingRef, fingerprint);
      expect(upgraded).toBeDefined();

      const sessionCookie = upgraded!.cookies.find((c) =>
        c.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`),
      );
      expect(sessionCookie, "exactly one admin session cookie").toBeDefined();
      expect(
        upgraded!.cookies.filter((c) =>
          c.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`),
        ),
      ).toHaveLength(1);

      expect(sessionCookie).toContain("Path=/");
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie).toContain("Secure");
      expect(sessionCookie).toContain("SameSite=Strict");
      // The `__Host-` prefix is void with a Domain attribute — host-only is the
      // whole point of the prefix (ADR-0001 §6).
      expect(sessionCookie).not.toContain("Domain");
      // Strict, not Lax: the portal's Lax profile is exactly what 011 tightens.
      expect(sessionCookie).not.toContain("SameSite=Lax");
    });

    it("EARS-1: the admin cookie value is an opaque server-side reference, not a token", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = app.get(AdminSessionService);

      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      const pendingRef = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      const fingerprint = computeFingerprint({
        userAgent: ADMIN_DEVICE["user-agent"],
        ip: "127.0.0.1",
        acceptLanguage: ADMIN_DEVICE["accept-language"],
      });
      const upgraded = await admin.upgradePending(pendingRef, fingerprint);
      const sid = upgraded!.principal.sid;

      // Not decodable as a JWT: no three dot-separated base64url segments whose
      // middle segment parses as JSON. A token in the cookie would put claims —
      // and, worse, an access grant — in the browser (EARS-1 forbids both).
      const segments = sid.split(".");
      expect(segments.length).not.toBe(3);

      // It IS a live reference: the record it names lives server-side, and the
      // cookie carries none of that record's contents.
      const record = await admin.getBySid(sid);
      expect(record).toBeDefined();
      expect(record!.sub.length).toBeGreaterThan(0);
      expect(sid).not.toContain(record!.sub);
      expect(sid).not.toContain(record!.zitadelSessionId);
    });

    it("EARS-1: an established admin session carries mfa = true by construction", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = app.get(AdminSessionService);

      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      const pendingRef = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      const fingerprint = computeFingerprint({
        userAgent: ADMIN_DEVICE["user-agent"],
        ip: "127.0.0.1",
        acceptLanguage: ADMIN_DEVICE["accept-language"],
      });
      const upgraded = await admin.upgradePending(pendingRef, fingerprint);

      expect(upgraded!.principal.mfa).toBe(true);
      const record = await admin.getBySid(upgraded!.principal.sid);
      expect(record!.mfa).toBe(true);
    });

    it("EARS-1: admin primary auth returns no token in the body and neither sets nor modifies the portal cookie", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);

      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });

      expect(login.statusCode).toBe(200);
      // The body is the state enum and nothing else — no token, no claims, no
      // reference (the reference travels in its own cookie).
      expect(login.json()).toEqual({ state: "mfa_pending_enrollment" });

      const names = login.cookies.map((c) => c.name);
      expect(names).toContain(ADMIN_PENDING_COOKIE_NAME);
      // No admin SESSION cookie yet — primary auth alone never issues one.
      expect(names).not.toContain(ADMIN_SESSION_COOKIE_NAME);
      expect(names).not.toContain(ADMIN_CSRF_COOKIE_NAME);
      // The doctor portal's cookie is untouched by this flow.
      expect(names).not.toContain(SESSION_COOKIE_NAME);
    });
  },
);
