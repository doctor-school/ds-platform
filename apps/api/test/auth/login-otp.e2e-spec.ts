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
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  DEFAULT_SMS_BUDGET_THRESHOLDS,
  SMS_BUDGET_THRESHOLDS,
} from "../../src/auth/sms-budget/sms-budget.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// Passwordless login (EARS-6 email-OTP / EARS-7 SMS-OTP) and the SMS toll-fraud
// budget (EARS-14). Both OTP variants are native Zitadel (`otp_email` / `otp_sms`)
// and converge on the single F2 session-establishment step — success sets a
// `__Host-` cookie and returns a token-free body (EARS-8), failure is the same
// generic 401 (EARS-16). Runs against a real Postgres with the IdP bound to the
// in-memory fake (design §2/§6); SMS sends are budget-gated before reaching the
// provider (EARS-14, design §10).
describe.skipIf(!process.env.DATABASE_URL)(
  "Passwordless OTP login (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let idp: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];
    const createdPhones: string[] = [];

    function uniqueEmail(tag: string): string {
      const email = `ears6-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function uniquePhone(): string {
      // E.164, kept inside the schema's 7–15 digit bound.
      const phone = `+7${Math.floor(1_000_000_000 + Math.random() * 8_999_999_999)}`;
      createdPhones.push(phone);
      return phone;
    }

    function setCookie(res: { headers: Record<string, unknown> }): string {
      const raw = res.headers["set-cookie"];
      return Array.isArray(raw) ? raw.join("\n") : ((raw as string) ?? "");
    }

    async function register(payload: Record<string, unknown>): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { ...payload, password, consent },
      });
      expect(res.statusCode).toBe(200);
    }

    // EARS-6/34 precondition: the email-OTP LOGIN challenge is armed only for a
    // VERIFIED account (an unverified one is routed to out-of-band verification,
    // EARS-34) — so a login-by-email-code test must verify the registrant first
    // ("Given a verified doctor_guest user", @EARS-6 scenario).
    async function verify(email: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        payload: { email, code: FAKE_VALID_CODE },
      });
      expect(res.statusCode).toBe(200);
    }

    beforeAll(async () => {
      idp = new FakeIdpClient();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
        // Generous budget so the EARS-6/7 happy paths are never the limiter here;
        // the breaker itself is exercised in the dedicated describe below.
        .overrideProvider(SMS_BUDGET_THRESHOLDS)
        .useValue(DEFAULT_SMS_BUDGET_THRESHOLDS)
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
      for (const phone of createdPhones.splice(0))
        await pool.query("DELETE FROM users WHERE phone = $1", [phone]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-6: when a user requests an email login code and submits the correct code, the system shall verify it via otp_email and establish a BFF session (__Host- cookie, no token in body)", async () => {
      const email = uniqueEmail("ok");
      await register({ email });
      await verify(email); // EARS-6 precondition: a verified account

      const requested = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: email, channel: "email" },
      });
      expect(requested.statusCode).toBe(200);
      expect(requested.json()).toEqual({ status: "otp_sent" });

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: email, code: FAKE_VALID_CODE, channel: "email" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "authenticated" });
      expect(JSON.stringify(res.json())).not.toMatch(/token/i);
      expect(setCookie(res)).toContain(`${SESSION_COOKIE_NAME}=`);
    });

    it("EARS-6: a wrong email OTP code is a generic 401 with no session cookie (enumeration-resistant, EARS-16)", async () => {
      const email = uniqueEmail("bad");
      await register({ email });
      await verify(email); // verified, so the challenge IS armed — the wrong code is the failure under test
      await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: email, channel: "email" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: email, code: "000000", channel: "email" },
      });

      expect(res.statusCode).toBe(401);
      expect(setCookie(res)).not.toContain(SESSION_COOKIE_NAME);
    });

    it("EARS-7: when a user under all SMS thresholds requests an SMS login code and submits the correct code, the system shall verify it via otp_sms and establish a BFF session", async () => {
      // #202: registration is email-primary, so register by email, then attach the
      // phone as the post-registration secondary identifier (login-by-phone +
      // SMS-OTP login operate on an attached phone). The fake's createUser rejects
      // a no-email create, so the seed MUST carry an email.
      const email = uniqueEmail("sms");
      const phone = uniquePhone();
      await register({ email });
      const { rows } = await pool.query(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      idp.attachPhone(rows[0].zitadel_sub as string, phone);
      const before = idp.smsOtpSendCount();

      const requested = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: phone, channel: "sms" },
      });
      expect(requested.statusCode).toBe(200);
      expect(requested.json()).toEqual({ status: "otp_sent" });
      // Under budget, the SMS actually reached the (fake) provider.
      expect(idp.smsOtpSendCount()).toBe(before + 1);

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: phone, code: FAKE_VALID_CODE, channel: "sms" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "authenticated" });
      expect(setCookie(res)).toContain(`${SESSION_COOKIE_NAME}=`);
    });
  },
);

// EARS-14 failure path — a dedicated app whose global daily SMS budget is already
// exhausted (breaker open). A send request must be refused with a generic
// "try later" and must NOT reach the provider.
describe.skipIf(!process.env.DATABASE_URL)(
  "SMS budget circuit-breaker (e2e, EARS-14)",
  () => {
    let app: NestFastifyApplication;
    let idp: FakeIdpClient;

    beforeAll(async () => {
      idp = new FakeIdpClient();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
        // Breaker already open: the daily budget is exhausted.
        .overrideProvider(SMS_BUDGET_THRESHOLDS)
        .useValue({ ...DEFAULT_SMS_BUDGET_THRESHOLDS, globalPerDay: 0 })
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-14: when the daily SMS budget is exhausted, an SMS login-code request is refused generically and no SMS is sent to the provider", async () => {
      const before = idp.smsOtpSendCount();

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: "+79991230000", channel: "sms" },
      });

      // A generic throttled refusal — not a 200 otp_sent.
      expect(res.statusCode).toBe(429);
      expect(JSON.stringify(res.json())).not.toMatch(/budget|breaker|quota/i);
      // The circuit-breaker tripped BEFORE the provider call: no SMS went out.
      expect(idp.smsOtpSendCount()).toBe(before);
    });
  },
);

// 003 EARS-34 (#1131): the login-by-email-code request for an existing but
// email-UNVERIFIED account. Zitadel never sends an `otp_email` LOGIN code to an
// unverified email (the historic silent dead-end), so the BFF routes that branch
// to recovery delivered PRIVATELY — the branded verify-to-sign-in code out-of-band
// via the mailer, and NO login challenge. A verified account arms the challenge
// unchanged (EARS-6); a nonexistent identifier is a silent no-op. The three
// synchronous responses are byte-identical in status, body, AND timing
// (@TimingEqualized ≤ 50 ms, EARS-16), so neither the response nor the /login UI
// is an existence/verification oracle. Runs against a real Postgres with the IdP
// fake wired to a FakeMailer so "exactly one out-of-band verification email" and
// "no challenge armed" are both observable over the HTTP surface.
describe.skipIf(!process.env.DATABASE_URL)(
  "Login-by-email-code, unverified out-of-band recovery (e2e, 003 EARS-34)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let mailer: FakeMailer;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const runId = Date.now();
    const createdEmails: string[] = [];

    function uniqueEmail(tag: string): string {
      const email = `ears34-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function register(email: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(res.statusCode).toBe(200);
    }

    async function verify(email: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        payload: { email, code: FAKE_VALID_CODE },
      });
      expect(res.statusCode).toBe(200);
    }

    /** POST the login-email-code request; return { status, body, ms }. */
    async function requestLoginCode(
      identifier: string,
    ): Promise<{ status: number; body: unknown; ms: number }> {
      const t0 = performance.now();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier, channel: "email" },
      });
      const ms = performance.now() - t0;
      return { status: res.statusCode, body: res.json(), ms };
    }

    beforeAll(async () => {
      mailer = new FakeMailer();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient(mailer))
        .overrideProvider(MAILER)
        .useValue(mailer)
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
      mailer.verificationCodeEmails.length = 0;
      mailer.passwordResetCodeEmails.length = 0;
      mailer.accountExistsNotices.length = 0;
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-34: an email login-code request for an existing-UNVERIFIED account sends exactly one out-of-band verification email and arms NO otp_email challenge", async () => {
      const email = uniqueEmail("unverified");
      await register(email); // unverified (no /verify)
      // Drop the registration cascade's own verification email — assert only what
      // the login-code request itself dispatches.
      mailer.verificationCodeEmails.length = 0;

      const { status, body } = await requestLoginCode(email);
      expect(status).toBe(200);
      expect(body).toEqual({ status: "otp_sent" });

      // Exactly one branded §13.3 verification-code email, out-of-band (EARS-29).
      expect(mailer.verificationCodeEmails).toEqual([
        { to: email, code: FAKE_VALID_CODE },
      ]);

      // NO otp_email login challenge was armed: submitting the (valid) code to the
      // login-verify route is the same generic 401 with no session cookie.
      const verifyRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: email, code: FAKE_VALID_CODE, channel: "email" },
      });
      expect(verifyRes.statusCode).toBe(401);
      const raw = verifyRes.headers["set-cookie"];
      const cookie = Array.isArray(raw) ? raw.join("\n") : ((raw as string) ?? "");
      expect(cookie).not.toContain(SESSION_COOKIE_NAME);
    });

    it("EARS-34: an email login-code request for a VERIFIED account arms the otp_email challenge and sends NO verification email", async () => {
      const email = uniqueEmail("verified");
      await register(email);
      await verify(email); // now verified
      // Drop the registration cascade's own verification email.
      mailer.verificationCodeEmails.length = 0;

      const { status, body } = await requestLoginCode(email);
      expect(status).toBe(200);
      expect(body).toEqual({ status: "otp_sent" });

      // A verified account gets the login challenge, not a verification mail.
      expect(mailer.verificationCodeEmails).toEqual([]);

      // The otp_email challenge was armed: the valid code now establishes a session.
      const verifyRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: email, code: FAKE_VALID_CODE, channel: "email" },
      });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json()).toEqual({ status: "authenticated" });
    });

    it("EARS-34/16: the response is byte-identical in status, body, AND timing across {nonexistent, existing-unverified, existing-verified}", async () => {
      const unverified = uniqueEmail("triad-unver");
      const verified = uniqueEmail("triad-ver");
      const nonexistent = `ears34-nobody-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      await register(unverified);
      await register(verified);
      await verify(verified);

      const none = await requestLoginCode(nonexistent);
      const unver = await requestLoginCode(unverified);
      const ver = await requestLoginCode(verified);

      // Identical status + body — the response discloses neither existence nor
      // verification state (EARS-16).
      for (const r of [none, unver, ver]) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ status: "otp_sent" });
      }

      // Identical timing within the EARS-16 ≤ 50 ms budget: the @TimingEqualized
      // interceptor floors every branch, so the existing/unknown delta collapses
      // to jitter. Assert each response engaged the floor (≥ 30 ms, allowing
      // scheduling jitter below the 40 ms floor) and the spread stays in budget.
      const spread =
        Math.max(none.ms, unver.ms, ver.ms) -
        Math.min(none.ms, unver.ms, ver.ms);
      expect(spread).toBeLessThanOrEqual(50);
      for (const r of [none, unver, ver]) expect(r.ms).toBeGreaterThanOrEqual(30);
    });
  },
);
