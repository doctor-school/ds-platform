import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { MyProfileSchema } from "@ds/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 003 EARS-27 — the account-profile v1 self-read (`GET /v1/me/profile`,
// design §12; GH #770). One thin, session-scoped projection of the caller's OWN
// `users` mirror row — `{ email, emailVerified, phone, phoneVerified,
// displayName }` — behind the same session guard as the sibling `/v1/me/*`
// reads. Data that already exists: no new columns, no IdP call, and NO write on
// any path (read-only — the mirror row must be byte-identical after every
// request). Self-only by construction: the subject comes from the session and
// the route takes no identifier parameter, so another user's identity fields
// are structurally unreachable. Unauthenticated → the same fail-closed generic
// 401 as the sibling reads (EARS-16-consistent).
//
// Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL
// or IDP_ISSUER is absent so the shared CI unit job stays green (requirements
// Verification, row 27).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "003 EARS-27 account profile self-read (e2e)",
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

    /** Register + login a doctor_guest; return the session cookie value. */
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

    function cookieHeader(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    function getProfile(
      headers: Record<string, string>,
    ): ReturnType<NestFastifyApplication["inject"]> {
      return app.inject({ method: "GET", url: "/v1/me/profile", headers });
    }

    /** The caller's full mirror row, for read-only (no-write) assertions. */
    async function dbRow(email: string): Promise<Record<string, unknown>> {
      const { rows } = await pool.query(
        `SELECT email, email_verified, phone, phone_verified, display_name,
                updated_at
           FROM users WHERE email = $1`,
        [email],
      );
      expect(rows).toHaveLength(1);
      return rows[0] as Record<string, unknown>;
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
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      // Delete by email — a fake-sub value collides on zitadel_sub across cases.
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-27: when an authenticated doctor reads their profile, the system shall return their OWN identity projection — null phone/displayName served truthfully as null, never omitted or fabricated", async () => {
      const email = uniqueEmail("doc-prof-null");
      const cookie = await doctorSession(email);

      const res = await getProfile(cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      const profile = MyProfileSchema.parse(res.json());
      // The caller's own row: email-registered, so email is present + verified
      // per the register flow; phone was never provided and the display name
      // never collected — both are EXPLICIT nulls on the wire (design §12:
      // nullable-and-present, not optional), so the client can distinguish
      // "unset" from "field missing".
      expect(profile.email).toBe(email);
      expect(profile.emailVerified).toBe(true);
      expect(profile.phone).toBeNull();
      // No phone on file ⇒ the verified-state is null (meaningless for an
      // absent identifier), never a fabricated `false` "unverified phone".
      expect(profile.phoneVerified).toBeNull();
      expect(profile.displayName).toBeNull();
      // Every contract key is PRESENT in the raw payload (nullable ≠ optional).
      const raw = res.json() as Record<string, unknown>;
      for (const key of [
        "email",
        "emailVerified",
        "phone",
        "phoneVerified",
        "displayName",
      ]) {
        expect(Object.keys(raw)).toContain(key);
      }
    });

    it("EARS-27: the profile read reflects the caller's saved display name once collected — still their OWN row only", async () => {
      const email = uniqueEmail("doc-prof-named");
      const cookie = await doctorSession(email);

      const put = await app.inject({
        method: "PUT",
        url: "/v1/me/display-name",
        headers: cookieHeader(cookie),
        payload: { displayName: "Анна Смирнова" },
      });
      expect(put.statusCode).toBe(200);

      const res = await getProfile(cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      const profile = MyProfileSchema.parse(res.json());
      expect(profile.email).toBe(email);
      expect(profile.displayName).toBe("Анна Смирнова");
    });

    it("EARS-27: two doctors each read strictly their OWN identity fields — no identifier parameter exists, so another user's email is structurally unreachable", async () => {
      const aEmail = uniqueEmail("doc-prof-a");
      const bEmail = uniqueEmail("doc-prof-b");
      const aCookie = await doctorSession(aEmail);
      const bCookie = await doctorSession(bEmail);

      const a = MyProfileSchema.parse(
        (await getProfile(cookieHeader(aCookie))).json(),
      );
      const b = MyProfileSchema.parse(
        (await getProfile(cookieHeader(bCookie))).json(),
      );
      expect(a.email).toBe(aEmail);
      expect(b.email).toBe(bEmail);
    });

    it("EARS-27: when an unauthenticated caller reads the profile, the system shall refuse with the same generic 401 as the sibling /v1/me/* reads", async () => {
      const anon = await getProfile(device);
      expect(anon.statusCode).toBe(401);

      // Same generic fail-closed shape as the sibling read (EARS-16-consistent):
      // identical status + no identity field leaks in the refusal body.
      const sibling = await app.inject({
        method: "GET",
        url: "/v1/me/display-name",
        headers: device,
      });
      expect(sibling.statusCode).toBe(401);
      expect((anon.json() as { message?: string }).message).toBe(
        (sibling.json() as { message?: string }).message,
      );
    });

    it("EARS-27: the profile read performs NO write on any path — the mirror row (updated_at included) is byte-identical after the read", async () => {
      const email = uniqueEmail("doc-prof-ro");
      const cookie = await doctorSession(email);

      const before = await dbRow(email);
      const ok = await getProfile(cookieHeader(cookie));
      expect(ok.statusCode).toBe(200);
      // An unauthenticated probe alongside — also write-free.
      await getProfile(device);
      const after = await dbRow(email);
      expect(after).toEqual(before);
    });
  },
);
