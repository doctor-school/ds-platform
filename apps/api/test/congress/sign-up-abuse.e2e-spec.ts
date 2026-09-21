import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  BOT_PROTECTED_KEY,
  type BotProtectionAction,
} from "../../src/bot-protection/bot-protection.types.js";
import { CongressSignUpController } from "../../src/congress/congress-signup.controller.js";
import { CONGRESS_SIGN_UP_CLOCK } from "../../src/congress/congress-signup.tokens.js";
import {
  CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE,
  DEFAULT_RATE_LIMIT_THRESHOLDS,
  RATE_LIMIT_THRESHOLDS,
  type RateLimitThresholds,
} from "../../src/auth/rate-limit/rate-limit.types.js";

/**
 * 044 V-4 / V-22 — the abuse surface of the public congress intake.
 *
 * The intake is unauthenticated and creates accounts, so it carries the same
 * two server-side protections the 003 register door does. Two properties are
 * proven here, and neither needs a written row: every request in this suite is
 * made with the clock set BEFORE the registration window opens, so the handler
 * refuses on the window (EARS-28) after the guards have already keyed the
 * request. What the suite asserts is therefore purely about the guards.
 *
 * The ceiling is the intake's OWN (60 / 15 min per client address), not the
 * platform default of 20: a congress landing page behind one corporate NAT
 * legitimately submits far more than an auth door does, and the scoped bucket is
 * what keeps that traffic from consuming the budget register / login / reset
 * share (rate-limit.types §scope).
 */
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "044 congress sign-up — abuse limits (e2e)",
  () => {
    let app: NestFastifyApplication;
    const fake = new FakeIdpClient();
    /** Fixed before the window opens — every request refuses without writing. */
    const now = new Date("2026-09-01T10:00:00.000+03:00");

    // The platform defaults, so the intake's own scoped ceiling is the one under
    // test; the per-user window is lifted because this suite deliberately floods
    // ONE address with MANY distinct addresses' worth of submissions.
    const thresholds: RateLimitThresholds = {
      ...DEFAULT_RATE_LIMIT_THRESHOLDS,
      perUserPer15Min: 1_000_000,
    };

    function submission(): Record<string, unknown> {
      return {
        surname: "Иванова",
        firstName: "Мария",
        email: `congress-abuse-${randomUUID()}@ds.test`,
        specialtyId: randomUUID(),
        workplace: "ГКБ №1",
        city: "Москва",
        region: "Москва",
        contactPhone: "+79001234567",
        personalDataConsent: true,
      };
    }

    async function post(forwardedFor: string) {
      return app.inject({
        method: "POST",
        url: "/v1/congress/sign-up",
        headers: { "x-forwarded-for": forwardedFor },
        payload: submission(),
      });
    }

    beforeAll(async () => {
      process.env.CONGRESS_SIGNUP_EVENT_ID = randomUUID();
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = `2026-10-01.sha256-${"a".repeat(64)}`;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(thresholds)
        .overrideProvider(CONGRESS_SIGN_UP_CLOCK)
        .useValue(() => now)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        // `trustProxy` is what makes `request.ip` the FORWARDED client address
        // rather than the socket peer — the production adapter is built the same
        // way from TRUSTED_PROXIES (api-application.ts).
        new FastifyAdapter({ trustProxy: true }),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    }, 60_000);

    afterAll(async () => {
      if (app) await app.close();
    });

    it("EARS-1: when the intake route is mounted, system shall gate it with the bot-protection challenge", () => {
      const marker = Reflect.getMetadata(
        BOT_PROTECTED_KEY,
        CongressSignUpController.prototype.signUp,
      ) as BotProtectionAction | undefined;

      expect(marker).toBe("congress-sign-up");
    });

    it("EARS-2: when submissions arrive through a trusted proxy, system shall throttle the forwarded client address at the intake ceiling and leave another address untouched", async () => {
      const client = "203.0.113.10";
      const other = "203.0.113.11";
      const ceiling =
        DEFAULT_RATE_LIMIT_THRESHOLDS.scopedPerIpPer15Min[
          CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE
        ];
      expect(ceiling).toBe(60);

      const statuses: number[] = [];
      for (let i = 0; i < ceiling; i++) {
        statuses.push((await post(client)).statusCode);
      }
      // Every submission inside the ceiling reaches the handler (and is refused
      // there on the window, not by the limiter).
      expect(statuses.every((s) => s === 422)).toBe(true);

      // The 61st from the SAME forwarded address is throttled…
      expect((await post(client)).statusCode).toBe(429);
      // …and a different forwarded client has its own, untouched window: the
      // key is the forwarded address, never the proxy's.
      expect((await post(other)).statusCode).toBe(422);
    }, 120_000);
  },
);
