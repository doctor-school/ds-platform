import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { LoginHandoffResponseSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import {
  InMemoryLoginHandoffStore,
  LOGIN_HANDOFF_STORE,
  LOGIN_HANDOFF_TTL_SECONDS,
} from "../../src/auth/login-handoff/login-handoff.store.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import type { RateLimitThresholds } from "../../src/auth/rate-limit/rate-limit.types.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  describeTiming,
  medianSpread,
  sampleInterleaved,
} from "../support/timing-oracle.js";

/**
 * 003 EARS-44 — `POST /v1/auth/login/otp/handoff`: the Congress sign-up's
 * reference (044 EARS-39) redeemed by `/login` into the EARS-34 code send for
 * the account it names, without the visitor typing the address.
 *
 * Bot protection is ENABLED here (a stub that accepts one token) so «no captcha
 * required» is a real assertion: the plain code request without a token is
 * refused while the hand-off goes through. The store is the in-memory binding
 * on an injected clock so the 24 h expiry is driven, not waited for; the Redis
 * binding (same contract) is exercised by the 044 sign-up suite (V-32) and the
 * store unit spec.
 */
const GOOD_TOKEN = "good-captcha";
const CAPTCHA = { "x-smartcaptcha-token": GOOD_TOKEN };
const FALLBACK = { status: "handoff_refused" };

class StubBotProtection implements BotProtection {
  verify(token: string): Promise<BotProtectionResult> {
    return Promise.resolve({ ok: token === GOOD_TOKEN });
  }
}

interface Harness {
  app: NestFastifyApplication;
  pool: pg.Pool;
  mailer: FakeMailer;
  store: InMemoryLoginHandoffStore;
  advance(ms: number): void;
}

async function boot(thresholds: RateLimitThresholds): Promise<Harness> {
  const mailer = new FakeMailer();
  let t = Date.now();
  const store = new InMemoryLoginHandoffStore(() => t);
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(IDP_CLIENT)
    .useValue(new FakeIdpClient(mailer))
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(BOT_PROTECTION)
    .useValue(new StubBotProtection())
    .overrideProvider(LOGIN_HANDOFF_STORE)
    .useValue(store)
    .overrideProvider(RATE_LIMIT_THRESHOLDS)
    .useValue(thresholds)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    pool: app.get<pg.Pool>(DRIZZLE_POOL),
    mailer,
    store,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-44 — login hand-off redemption (e2e)",
  () => {
    let h: Harness;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const runId = Date.now();
    const createdEmails: string[] = [];

    function uniqueEmail(tag: string): string {
      const email = `ears44-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** An account (optionally verified) and a reference minted for it. */
    async function accountWithReference(
      tag: string,
      verified: boolean,
    ): Promise<{ email: string; ref: string }> {
      const email = uniqueEmail(tag);
      const reg = await h.app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: CAPTCHA,
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      if (verified) {
        const v = await h.app.inject({
          method: "POST",
          url: "/v1/auth/verify",
          headers: CAPTCHA,
          payload: { email, code: FAKE_VALID_CODE },
        });
        expect(v.statusCode).toBe(200);
      }
      const { rows } = await h.pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      const ref = await h.store.mint(rows[0]!.id);
      clearMail();
      return { email, ref };
    }

    function clearMail(): void {
      h.mailer.verificationCodeEmails.length = 0;
      h.mailer.loginCodeEmails.length = 0;
      h.mailer.passwordResetCodeEmails.length = 0;
      h.mailer.reRegistrationCodeEmails.length = 0;
    }

    async function redeem(
      ref: unknown,
    ): Promise<{ status: number; body: unknown; ms: number }> {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/handoff",
        payload: ref === undefined ? {} : { ref },
      });
      return {
        status: res.statusCode,
        body: res.json(),
        ms: performance.now() - t0,
      };
    }

    beforeAll(async () => {
      h = await boot(RELAXED_RATE_LIMIT);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(h.pool, "email", email);
      clearMail();
    });

    afterAll(async () => {
      await h.app.close();
    });

    it("003 EARS-44: a live reference for a VERIFIED account sends the otp_email login code and returns the address", async () => {
      const { email, ref } = await accountWithReference("verified", true);

      const { status, body } = await redeem(ref);

      expect(status).toBe(200);
      expect(LoginHandoffResponseSchema.parse(body)).toEqual({
        status: "otp_sent",
        identifier: email,
      });
      expect(h.mailer.loginCodeEmails.map((m) => m.to)).toEqual([email]);
      expect(h.mailer.verificationCodeEmails).toEqual([]);
      // The code that was sent signs the account in (EARS-6 convergence).
      const login = await h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp",
        payload: { identifier: email, code: FAKE_VALID_CODE, channel: "email" },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toEqual({ status: "authenticated" });
    });

    it("003 EARS-44: a live reference for an UNVERIFIED account sends the verification code in the sign-in mail (EARS-34)", async () => {
      const { email, ref } = await accountWithReference("unverified", false);

      const { status, body } = await redeem(ref);

      expect(status).toBe(200);
      expect(body).toEqual({ status: "otp_sent", identifier: email });
      expect(h.mailer.loginCodeEmails).toEqual([
        { to: email, code: FAKE_VALID_CODE, lifetime: "1h" },
      ]);
      expect(h.mailer.verificationCodeEmails).toEqual([]);
    });

    it("003 EARS-44: redemptions 2 and 3 re-issue the code; the 4th gets the fallback and no mail", async () => {
      const { email, ref } = await accountWithReference("fourth", true);

      for (let i = 1; i <= 3; i++) {
        expect(await redeem(ref)).toMatchObject({
          status: 200,
          body: { status: "otp_sent", identifier: email },
        });
      }
      expect(h.mailer.loginCodeEmails.map((m) => m.to)).toEqual([
        email,
        email,
        email,
      ]);
      clearMail();

      expect(await redeem(ref)).toMatchObject({ status: 200, body: FALLBACK });
      expect(h.mailer.loginCodeEmails).toEqual([]);
      expect(h.mailer.verificationCodeEmails).toEqual([]);
    });

    it("003 EARS-44: a reference past its 24 h gets the fallback and no mail", async () => {
      const { ref } = await accountWithReference("expired", true);
      h.advance(LOGIN_HANDOFF_TTL_SECONDS * 1000);

      expect(await redeem(ref)).toMatchObject({ status: 200, body: FALLBACK });
      expect(h.mailer.loginCodeEmails).toEqual([]);
    });

    it("003 EARS-44: exhausted, expired, unknown, malformed and missing references answer one identical response in status, body and timing", async () => {
      const exhausted = await accountWithReference("triad-exhausted", true);
      for (let i = 0; i < 3; i++) await redeem(exhausted.ref);
      const expired = await accountWithReference("triad-expired", true);
      h.advance(LOGIN_HANDOFF_TTL_SECONDS * 1000);
      clearMail();
      const unknown = "Z".repeat(43);

      const timing = await sampleInterleaved(
        [exhausted.ref, expired.ref, unknown, "not-a-reference", undefined].map(
          (ref) => () => redeem(ref),
        ),
      );
      console.info(
        `EARS-44 exhausted/expired/unknown/malformed/missing: ${describeTiming(timing)} ms`,
      );

      for (const r of timing.flatMap((c) => c.results)) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual(FALLBACK);
        expect(r.ms).toBeGreaterThanOrEqual(30);
      }
      expect(medianSpread(timing)).toBeLessThanOrEqual(50);
      expect(h.mailer.loginCodeEmails).toEqual([]);
      expect(h.mailer.verificationCodeEmails).toEqual([]);
    });

    it("003 EARS-44: the hand-off needs no captcha while the plain code request still does", async () => {
      const { email, ref } = await accountWithReference("no-captcha", true);

      const plain = await h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: email, channel: "email" },
      });
      expect(plain.statusCode).not.toBe(200);

      expect(await redeem(ref)).toMatchObject({
        status: 200,
        body: { status: "otp_sent", identifier: email },
      });
    });

    it("003 EARS-44: the reference is random, carries no data and only its SHA-256 is stored", async () => {
      const { ref } = await accountWithReference("opaque", true);
      expect(ref).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(h.store.storedKeys().join()).not.toContain(ref);
    });
  },
);

describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-44 — hand-off under the EARS-13 limits (e2e)",
  () => {
    let h: Harness;
    const email = `ears44-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

    beforeAll(async () => {
      // Per-account ceiling of 2 code requests; the source-address budget stays
      // out of the way so the per-account dimension alone decides.
      h = await boot({ ...RELAXED_RATE_LIMIT, perUserPer15Min: 2 });
    });

    afterAll(async () => {
      await deleteUserFixture(h.pool, "email", email);
      await h.app.close();
    });

    it("003 EARS-44: each redemption counts as a code request per account; a refusal is the generic EARS-13 throttled response with no mail", async () => {
      const reg = await h.app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: CAPTCHA,
        payload: {
          email,
          password: "Aa1!ufficiently-long-pw",
          consent: [{ purpose: "tos", version: "2026-01" }],
        },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await h.pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      const ref = await h.store.mint(rows[0]!.id);
      h.mailer.loginCodeEmails.length = 0;

      // Registration consumed one per-account unit; one redemption fits.
      const first = await h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/handoff",
        payload: { ref },
      });
      expect(first.statusCode).toBe(200);
      h.mailer.loginCodeEmails.length = 0;

      const refused = await h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/handoff",
        payload: { ref },
      });
      const plain = await h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        headers: CAPTCHA,
        payload: { identifier: email, channel: "email" },
      });

      expect(refused.statusCode).toBe(429);
      expect(plain.statusCode).toBe(429);
      // Byte-identical to the plain code request's throttled answer: no
      // address, nothing that names the account.
      expect(refused.json()).toEqual(plain.json());
      expect(JSON.stringify(refused.json())).not.toContain(email);
      expect(h.mailer.loginCodeEmails).toEqual([]);
    });
  },
);
