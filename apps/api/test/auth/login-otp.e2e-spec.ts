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
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
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
describe.skipIf(!process.env.DATABASE_URL)("Passwordless OTP login (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let idp: FakeIdpClient;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "sufficiently-long-pw";
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
    const phone = uniquePhone();
    await register({ phone });
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
});

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
