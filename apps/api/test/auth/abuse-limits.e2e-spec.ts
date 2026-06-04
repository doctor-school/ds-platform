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
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { LOGIN_CHALLENGE_CONFIG } from "../../src/auth/login-challenge/login-challenge.types.js";
import { BOT_PROTECTION } from "../../src/bot-protection/index.js";
import type {
  BotProtection,
  BotProtectionResult,
} from "../../src/bot-protection/index.js";

const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };

/** Build + init an app with the given overrides applied to a fresh AppModule. */
async function bootApp(
  overrides: (b: ReturnType<typeof Test.createTestingModule>) => void,
): Promise<NestFastifyApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDP_CLIENT)
    .useValue(new FakeIdpClient());
  overrides(builder);
  const moduleRef: TestingModule = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * Delete the registered test users (by email) before closing the app — the
 * `users.zitadel_sub` unique constraint plus the fake's deterministic
 * `fake-sub-N` numbering means a row left behind collides with the next e2e
 * file's first registration (the suite is serial — vitest `fileParallelism:false`).
 */
async function cleanup(
  app: NestFastifyApplication,
  emails: string[],
): Promise<void> {
  const pool = app.get<pg.Pool>(DRIZZLE_POOL);
  for (const email of emails)
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
  await app.close();
}

// EARS-13 (rate-limit) + EARS-16 (timing equalization) + EARS-17 (conditional
// login challenge) over HTTP — the cross-cutting abuse defenses of 003 F6
// (ADR-0001 §7). Each block boots its own app because each tunes a different
// guard's thresholds.
describe.skipIf(!process.env.DATABASE_URL)("Auth abuse limits (e2e)", () => {
  // ── EARS-13: rate limiting ────────────────────────────────────────────────
  describe("EARS-13: rate limiting", () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await bootApp((b) =>
        b
          // Tight per-user window so the boundary is reached in a few requests.
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue({
            perUserPer15Min: 3,
            perIpPer15Min: 1000,
            perAsnPerHour: 1000,
          }),
      );
    });
    afterAll(async () => {
      await app.close();
    });

    it("EARS-13: when an identifier exceeds its window, the system shall return a generic 429 without revealing account existence", async () => {
      const identifier = "ratelimited@ds.test"; // unknown account on purpose
      const attempt = () =>
        app.inject({
          method: "POST",
          url: "/v1/auth/login",
          headers: device,
          payload: { identifier, password: "whatever-long-pw" },
        });

      // 3 allowed (each a generic 401 — unknown account), the 4th is throttled.
      for (let i = 0; i < 3; i++)
        expect((await attempt()).statusCode).toBe(401);
      const throttled = await attempt();
      expect(throttled.statusCode).toBe(429);
      // Generic body: no threshold, no account-existence signal.
      expect(JSON.stringify(throttled.json())).not.toContain(identifier);
    });
  });

  // ── EARS-16: timing equalization ──────────────────────────────────────────
  describe("EARS-16: timing equalization", () => {
    let app: NestFastifyApplication;
    beforeAll(async () => {
      app = await bootApp((b) =>
        b.overrideProvider(RATE_LIMIT_THRESHOLDS).useValue(RELAXED_RATE_LIMIT),
      );
    });
    afterAll(() => cleanup(app, ["timing-known@ds.test"]));

    async function timeReset(identifier: string): Promise<number> {
      const start = Date.now();
      await app.inject({
        method: "POST",
        url: "/v1/auth/password/reset",
        payload: { identifier },
      });
      return Date.now() - start;
    }

    it("EARS-16: the existing-account and unknown-account reset paths resolve within the ≤50 ms timing budget", async () => {
      // Seed one existing identifier; compare its reset latency to an unknown one.
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "timing-known@ds.test",
          password: "sufficiently-long-pw",
          consent: [{ purpose: "tos", version: "2026-01" }],
        },
      });

      // Median of a few samples each, to damp single-request scheduling jitter.
      const known = median([
        await timeReset("timing-known@ds.test"),
        await timeReset("timing-known@ds.test"),
        await timeReset("timing-known@ds.test"),
      ]);
      const unknown = median([
        await timeReset("timing-unknown@ds.test"),
        await timeReset("timing-unknown@ds.test"),
        await timeReset("timing-unknown@ds.test"),
      ]);
      // Both floored to the equalization target, so the delta is within budget.
      expect(Math.abs(known - unknown)).toBeLessThanOrEqual(50);
    });
  });

  // ── EARS-17: conditional login challenge ──────────────────────────────────
  describe("EARS-17: login challenge after N failures", () => {
    let app: NestFastifyApplication;
    const GOOD_TOKEN = "good-captcha";

    /** An ENABLED bot-protection provider so the challenge actually gates. */
    class StubBotProtection implements BotProtection {
      verify(token: string): Promise<BotProtectionResult> {
        return Promise.resolve({ ok: token === GOOD_TOKEN });
      }
    }

    beforeAll(async () => {
      app = await bootApp((b) =>
        b
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          .overrideProvider(BOT_PROTECTION)
          .useValue(new StubBotProtection())
          // Challenge after just 2 failures so the boundary is quick to reach.
          .overrideProvider(LOGIN_CHALLENGE_CONFIG)
          .useValue({ threshold: 2, windowMs: 15 * 60 * 1000 }),
      );
    });
    afterAll(() => cleanup(app, ["challenge-clear@ds.test"]));

    const badLogin = (extraHeaders: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { ...device, ...extraHeaders },
        payload: { identifier: "challenge@ds.test", password: "wrong-pw-here" },
      });

    it("EARS-17: a first login is not challenged, but after N failures a token is required", async () => {
      // The first two failures are unchallenged generic 401s (not 403).
      expect((await badLogin()).statusCode).toBe(401);
      expect((await badLogin()).statusCode).toBe(401);

      // Now over the threshold: the next attempt WITHOUT a captcha token is
      // refused by the challenge guard (generic 403), before the credentials run.
      const challenged = await badLogin();
      expect(challenged.statusCode).toBe(403);

      // The same attempt WITH a valid token passes the guard and reaches the
      // (still-wrong) credential check — a 401, not the 403 challenge.
      const withToken = await badLogin({ "x-smartcaptcha-token": GOOD_TOKEN });
      expect(withToken.statusCode).toBe(401);
    });

    it("EARS-17: a successful login clears the challenge for that origin", async () => {
      const email = "challenge-clear@ds.test";
      const password = "sufficiently-long-pw";
      // Register is @BotProtected, and this block binds an ENABLED stub provider,
      // so the registration must carry the captcha token too.
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: { "x-smartcaptcha-token": GOOD_TOKEN },
        payload: {
          email,
          password,
          consent: [{ purpose: "tos", version: "2026-01" }],
        },
      });

      // Two failures arm the challenge…
      for (let i = 0; i < 2; i++)
        await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          headers: device,
          payload: { identifier: email, password: "wrong-pw-here" },
        });
      // …a token-bearing correct login succeeds and clears the window…
      const ok = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { ...device, "x-smartcaptcha-token": GOOD_TOKEN },
        payload: { identifier: email, password },
      });
      expect(ok.statusCode).toBe(200);
      expect(
        ok.cookies.find((c) => c.name === SESSION_COOKIE_NAME),
      ).toBeDefined();

      // …so the next login no longer needs a captcha token.
      const after = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(after.statusCode).toBe(200);
    });
  });
});

/** Median of a small sample (odd length), robust to a single jittery request. */
function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
