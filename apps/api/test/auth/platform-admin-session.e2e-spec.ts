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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// #1038 regression: the auth session-self surface (GET /v1/auth/session,
// POST /v1/auth/refresh, POST /v1/auth/logout) classifies "any authenticated
// principal", not "doctor". A principal granted ONLY `platform_admin` (no
// `doctor_guest` baseline — e.g. an operator provisioned admin-only) previously
// logged in fine, then every session-self call 403'd on `insufficient role`,
// locking the admin surface out and orphaning 30-day sessions. These endpoints
// now accept `["doctor_guest", "platform_admin"]`, so the single-role grant is
// sufficient. Mirrors the sibling session / refresh-logout e2e setup (fake IdP,
// relaxed rate limits, fingerprint-bound cookie); the platform_admin-only
// principal is built by granting `platform_admin` and revoking the register-time
// `doctor_guest` grant, matching an operator whose only authorization is admin.
describe.skipIf(!process.env.DATABASE_URL)(
  "platform_admin-only session surface (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1038-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /**
     * Register + log in a principal whose ONLY project role is `platform_admin`:
     * register auto-grants `doctor_guest`, so we grant `platform_admin` and revoke
     * `doctor_guest` before login (roles are captured into the session at login).
     * Returns the session cookie value.
     */
    async function adminOnlySession(email: string): Promise<string> {
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
      const sub = rows[0]!.zitadel_sub;
      await fake.grantProjectRole(sub, "platform_admin");
      await fake.revokeProjectRole(sub, "doctor_guest");
      expect(fake.grantedRoles(sub)).toEqual(["platform_admin"]);

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

    it("EARS-8: a platform_admin-only principal (no doctor_guest) reads its own session (200), roles echoed", async () => {
      const cookieValue = await adminOnlySession(uniqueEmail());

      const res = await app.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sub: string; roles: string[]; mfa: boolean };
      expect(body.roles).toEqual(["platform_admin"]);
      expect(body.roles).not.toContain("doctor_guest");
    });

    it("EARS-9: a platform_admin-only principal refreshes its own session (200)", async () => {
      const cookieValue = await adminOnlySession(uniqueEmail());
      const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`;

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        headers: { ...device, cookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "refreshed" });
    });

    it("EARS-10: a platform_admin-only principal logs out of its own session (200)", async () => {
      const cookieValue = await adminOnlySession(uniqueEmail());
      const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`;

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { ...device, cookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "logged_out" });
    });
  },
);
