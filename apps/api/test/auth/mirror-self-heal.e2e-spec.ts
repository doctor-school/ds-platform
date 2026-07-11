import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { SessionClaims } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 003 EARS-26 — read-path mirror self-heal (GH #709). A valid IdP session whose
// `zitadel_sub` has NO `users` mirror row (webhook miss/lag, or a lost mirror
// row while the IdP session stays alive) used to bounce every authenticated
// mirror-backed surface: the read threw `UnknownSubjectError` → the generic 401
// (EARS-16) → the portal's silent `/login` → `/account` carousel (#697 keeps
// authenticated sessions off auth surfaces). The mirror is a MIRROR of the IdP
// (design §5): when the session subject resolves but the row is absent, the
// auth layer lazily re-materializes it with the same idempotent
// `UserMirrorService.upsert` the webhook/sweep use, then the request proceeds
// as normal. EARS-16 for genuinely unauthenticated callers is UNCHANGED.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "003 EARS-26 mirror self-heal on authenticated read (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

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

    function authed(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    /** The session's IdP subject, read off the session surface (introspection-only, no mirror). */
    async function sessionSub(cookie: string): Promise<string> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: authed(cookie),
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as SessionClaims).sub;
    }

    beforeAll(async () => {
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
      // Cleanup by email — fake subs (`fake-sub-N`) collide across suites on
      // `zitadel_sub`, emails are unique per run.
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-26: an authenticated read whose sub has no mirror row self-heals the mirror and serves the request — no generic 401, twice (idempotent)", async () => {
      const email = uniqueEmail("orphan");
      const cookie = await doctorSession(email);
      const sub = await sessionSub(cookie);

      // Sanity: the freshly-registered doctor's read works.
      const before = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: authed(cookie),
      });
      expect(before.statusCode).toBe(200);

      // Orphan the session: the mirror row vanishes while the IdP session (and
      // its cookie) stays alive — the webhook-miss / lost-row production state.
      await pool.query("DELETE FROM users WHERE zitadel_sub = $1", [sub]);

      // The authed read self-heals the mirror and proceeds — this was the 401
      // that fed the silent /login → /account carousel.
      const healed = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: authed(cookie),
      });
      expect(healed.statusCode).toBe(200);
      expect(healed.json()).toEqual([]);

      // The mirror row was re-materialized from the IdP (email restored, the
      // doctor_guest projection re-granted).
      const { rows } = await pool.query(
        "SELECT email, role FROM users WHERE zitadel_sub = $1",
        [sub],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe(email);
      expect(rows[0].role).toBe("doctor_guest");

      // Idempotency: a second authed read on the healed mirror also serves.
      const again = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: authed(cookie),
      });
      expect(again.statusCode).toBe(200);
    });

    it("EARS-26: a genuinely unauthenticated read stays the generic 401 and heals nothing (EARS-16 unchanged)", async () => {
      const countBefore = await pool.query("SELECT count(*)::int AS n FROM users");
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/events",
        headers: device,
      });
      expect(res.statusCode).toBe(401);
      const countAfter = await pool.query("SELECT count(*)::int AS n FROM users");
      expect(countAfter.rows[0].n).toBe(countBefore.rows[0].n);
    });
  },
);
