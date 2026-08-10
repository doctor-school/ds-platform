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
  ADMIN_CSRF_HEADER,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";
import { ADMIN_SESSION_STORE } from "../../src/auth/admin-session/admin-session.types.js";
import type { AdminSessionStore } from "../../src/auth/admin-session/admin-session.types.js";
import { establishAdminSession } from "../setup/admin-session.js";

/**
 * 011 Verification row 10 — EARS-10: the new tier conforms to the ADR-0001 §6 /
 * design §7.1 session profile in full. It is a second cookie over the shipped 003
 * machinery, **not** a second session model: server-side record, fingerprint
 * binding that invalidates on mismatch, TTL, force-logout, CSRF double-submit on
 * every state-changing admin endpoint.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-10 — admin session profile conformance (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];

    function uniqueEmail(): string {
      const email = `ears1190d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

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
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-10: the session lives server-side — the browser holds only the opaque reference", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      const store = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);
      const record = await store.get(admin.sid);
      expect(record).toBeDefined();
      expect(record!.sub).toBe(sub);
      // Every field of the principal is in the record, and none of it is in
      // anything the browser received — the cookie is a reference, not a payload.
      expect(admin.cookieHeader).not.toContain(record!.sub);
      expect(admin.cookieHeader).not.toContain(record!.zitadelSessionId);
      expect(admin.cookieHeader).toContain(admin.sid);
    });

    it("EARS-10: a fingerprint mismatch invalidates the session on the very next request", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      // Same cookie, different device — a stolen cookie replayed elsewhere.
      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: {
          ...admin.headers,
          "user-agent": "SomeoneElse/9.9",
        },
      });
      expect(res.statusCode).toBe(401);

      const { rows } = await pool.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM audit_ledger WHERE event_type = 'auth.session.rejected' AND reason = 'fingerprint_mismatch'",
      );
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);

      // The untampered device still works — the mismatch refused the request, it
      // did not corrupt the record.
      const ok = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: admin.headers,
      });
      expect(ok.statusCode).toBe(200);
    });

    it("EARS-10: a state-changing admin endpoint is refused without the CSRF double-submit header", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      const missing = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: admin.headersWithoutCsrf,
      });
      expect(missing.statusCode).toBe(401);

      const wrong = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...admin.headersWithoutCsrf,
          [ADMIN_CSRF_HEADER]: "not-the-token",
        },
      });
      expect(wrong.statusCode).toBe(401);

      const { rows } = await pool.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM audit_ledger WHERE event_type = 'auth.session.rejected' AND reason = 'csrf_mismatch'",
      );
      expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(2);
    });

    it("EARS-10: a READ admin endpoint needs no CSRF header (double-submit gates state changes only)", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: admin.headersWithoutCsrf,
      });
      expect(res.statusCode).toBe(200);
    });

    it("EARS-10: force-logout revokes every admin session of the subject immediately", async () => {
      const email = uniqueEmail();
      const sub = await registerAdmin(email);
      // The in-repo fake mints sequential subs per instance, so the SAME `sub`
      // recurs across suites and across runs against this shared database
      // (recorded gotcha: the e2e fake-sub collision). Count the DELTA this test
      // caused rather than the absolute row count for that subject.
      const forceRows = async (): Promise<number> => {
        const { rows } = await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM audit_ledger
            WHERE subject_id = $1 AND event_type = 'auth.session.terminated' AND reason = 'force'`,
          [sub],
        );
        return Number(rows[0]!.n);
      };
      const before = await forceRows();
      const first = await establishAdminSession(app, {
        identifier: email,
        password,
      });
      const second = await establishAdminSession(app, {
        identifier: email,
        password,
      });
      expect(first.sid).not.toBe(second.sid);

      await app.get(AdminSessionService).forceLogout(sub);

      for (const handle of [first, second]) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/admin/events",
          headers: handle.headers,
        });
        expect(res.statusCode).toBe(401);
      }

      // One terminal row per revoked session — not one vague row for the batch.
      expect((await forceRows()) - before).toBe(2);
    });

    it("EARS-10: an expired admin session record refuses the request (TTL is enforced by the store)", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      // Re-write the record with an expiry in the past through the same port the
      // service writes through — no volume poking, no clock mocking.
      const store = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);
      const record = (await store.get(admin.sid))!;
      await store.create({ ...record, expiresAtMs: Date.now() - 1000 });

      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: admin.headers,
      });
      expect(res.statusCode).toBe(401);
    });

    it("EARS-10: the admin tier stores no credential at all — no IdP token is held at rest", async () => {
      const email = uniqueEmail();
      await registerAdmin(email);
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
      });

      const record = (await app
        .get<AdminSessionStore>(ADMIN_SESSION_STORE)
        .get(admin.sid))!;
      // The exact field set — pinned so a future field cannot arrive unnoticed.
      // No `accessToken` / `refreshToken`: nothing on this tier reads one, and a
      // live 30-day refresh token at rest would widen the blast radius of a Redis
      // compromise on precisely the tier 011 exists to harden.
      expect(Object.keys(record).sort()).toEqual(
        [
          "csrfToken",
          "expiresAtMs",
          "fingerprint",
          "mfa",
          "roles",
          "sid",
          "sub",
          "zitadelSessionId",
        ].sort(),
      );
      // The cookie is the only client-side artifact of the tier.
      expect(admin.cookieHeader).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    });
  },
);
