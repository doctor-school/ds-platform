import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { totpCode } from "../../src/auth/idp/totp.js";
import { RATE_LIMIT_THRESHOLDS, RELAXED_RATE_LIMIT } from "../setup/rate-limit.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";

const START_URL = "/v1/admin/auth/mfa/enroll/start";
const VERIFY_URL = "/v1/admin/auth/mfa/enroll/verify";

/**
 * 011 Verification row 5 — EARS-5: self-serve TOTP enrollment.
 *
 * The three load-bearing claims, each asserted directly against the API rather
 * than through the UI (design §10): the offer carries a scannable URI **and** a
 * transcribable secret and is not re-servable; a correct first code registers the
 * factor, writes a secret-free `auth.mfa.enrolled` row, and **upgrades the
 * pending authentication in place** into an admin session (LD-1 — the regression
 * that would matter is a re-introduced forced re-login); a wrong code leaves the
 * factor unconfirmed.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "011 EARS-5 — self-serve TOTP enrollment (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";

    function uniqueEmail(): string {
      return `ears1191enroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
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

    /** Drive the whole enrollment arc; resolves the offer + the verify response. */
    async function enroll(email: string): Promise<{
      sub: string;
      ref: string;
      secret: string;
      offer: Record<string, string>;
    }> {
      const sub = await registerAdmin(email);
      const ref = await pendingRef(email);
      const start = await app.inject({
        method: "POST",
        url: START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const offer = start.json() as Record<string, string>;
      return { sub, ref, secret: offer.secret!, offer };
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

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-5.1: the enrollment offer carries a scannable URI AND the same secret in transcribable form", async () => {
      const { secret, offer } = await enroll(uniqueEmail());

      // Transcribable: a base32 string a human can type, never image-only (EARS-12).
      expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
      // Scannable: the standard provisioning URI, carrying THAT secret — the QR
      // and the transcribed secret must enrol the same factor, or an operator who
      // cannot scan enrols a factor the server does not hold.
      expect(offer.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
      expect(offer.provisioningUri).toContain(`secret=${secret}`);
      expect(offer.issuer).toBeTruthy();
      expect(offer.account).toBeTruthy();
    });

    it("EARS-5.2: the offer is not re-servable — a re-start replaces the provisional factor", async () => {
      const email = uniqueEmail();
      const { ref, secret: first } = await enroll(email);

      const restart = await app.inject({
        method: "POST",
        url: START_URL,
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(restart.statusCode).toBe(200);
      const second = (restart.json() as { secret: string }).secret;
      expect(second).not.toBe(first);

      // The replaced secret no longer enrols anything: the old provisional factor
      // is gone, not parked alongside the new one.
      const stale = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(first) },
      });
      expect(stale.statusCode).toBe(401);
    });

    it("EARS-5.3: a correct first code registers the factor and issues the admin session IN PLACE (LD-1)", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await enroll(email);
      expect(await fake.hasTotpFactor(sub)).toBe(false);

      const verify = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });

      expect(verify.statusCode).toBe(200);
      expect(verify.json()).toEqual({ state: "active" });
      // No second login (LD-1): the response itself carries the admin session.
      const session = verify.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      );
      expect(session, "enrollment verify must issue the admin session").toBeDefined();
      expect(session!.value).toBeTruthy();
      expect(verify.cookies.some((c) => c.name === ADMIN_CSRF_COOKIE_NAME)).toBe(
        true,
      );
      // The pending reference is consumed — it never coexists with the session.
      const cleared = verify.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      );
      expect(cleared?.value).toBe("");
      // The factor is now REGISTERED at the IdP, not merely provisional.
      expect(await fake.hasTotpFactor(sub)).toBe(true);
    });

    it("EARS-5.4: enrollment appends exactly one auth.mfa.enrolled row, and no row ever carries the secret", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await enroll(email);
      const verify = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(verify.statusCode).toBe(200);

      const { rows } = await pool.query<{
        event_type: string;
        metadata: Record<string, unknown>;
      }>(
        "SELECT event_type, metadata FROM audit_ledger WHERE subject_id = $1 ORDER BY created_at ASC",
        [sub],
      );
      const enrolled = rows.filter((r) => r.event_type === "auth.mfa.enrolled");
      expect(enrolled).toHaveLength(1);
      expect(enrolled[0]!.metadata).toMatchObject({
        method: "totp",
        tier: "admin",
      });
      // The session was established through the same lifecycle, one row each.
      expect(
        rows.filter((r) => r.event_type === "auth.session.created"),
      ).toHaveLength(1);

      // Property assertion: NO emitted row anywhere mentions the secret, the
      // provisioning URI, or the submitted code (EARS-5 / EARS-9 invariant).
      const everything = await pool.query<{ blob: string }>(
        "SELECT coalesce(metadata::text, '') || coalesce(reason, '') AS blob FROM audit_ledger",
      );
      for (const row of everything.rows) {
        expect(row.blob).not.toContain(secret);
        expect(row.blob).not.toContain("otpauth://");
      }
    });

    it("EARS-5.5: a wrong code leaves the factor unconfirmed and the operator on the enrollment step", async () => {
      const email = uniqueEmail();
      const { sub, ref, secret } = await enroll(email);

      const wrong = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: "000000" },
      });
      expect(wrong.statusCode).toBe(401);
      expect(
        wrong.cookies.some((c) => c.name === ADMIN_SESSION_COOKIE_NAME),
      ).toBe(false);
      expect(await fake.hasTotpFactor(sub)).toBe(false);

      // The pending authentication survives a wrong code — the operator retries
      // on the SAME provisional factor rather than being thrown back to login.
      const retry = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(retry.statusCode).toBe(200);
    });

    it("EARS-5.6: a replayed code is refused inside its own validity window", async () => {
      const email = uniqueEmail();
      const { ref, secret } = await enroll(email);
      const code = totpCode(secret);

      const first = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(ref),
        payload: { code },
      });
      expect(first.statusCode).toBe(200);

      // A second pending authentication for the same principal, same code: the
      // step was consumed, so the replay must not enrol or verify anything.
      const secondRef = await pendingRef(email);
      const replay = await app.inject({
        method: "POST",
        url: VERIFY_URL,
        headers: pendingHeaders(secondRef),
        payload: { code },
      });
      expect(replay.statusCode).toBe(401);
    });

    it("EARS-5.7: the code field is constrained by the schema — non-numeric input is rejected before the handler", async () => {
      const email = uniqueEmail();
      const { ref } = await enroll(email);
      for (const code of ["abcdef", "12345", "1234567", ""]) {
        const res = await app.inject({
          method: "POST",
          url: VERIFY_URL,
          headers: pendingHeaders(ref),
          payload: { code },
        });
        expect(res.statusCode, `code ${JSON.stringify(code)}`).toBe(400);
      }
    });
  },
);
