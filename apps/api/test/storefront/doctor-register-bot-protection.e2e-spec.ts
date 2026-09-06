import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  BotProtectionErrorCodes,
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  MEDICAL_WORKER_DECLARATION_VERSION,
  PARTNER_DATA_SHARING_VERSION,
} from "../../src/storefront/doctor-register.service.js";

/**
 * 021 EARS-19 (#1558) — the server half of the bot-protection wiring on the
 * doctor storefront's registration command.
 *
 * The client half of this slice is what changed: the storefront now runs the
 * 003 challenge inside its submit and sends the minted token on the
 * `x-smartcaptcha-token` HEADER. This suite proves the thing that makes that
 * wiring worth anything — that `POST /v1/storefront/doctor/register` is
 * genuinely gated, so a replayed submission that skips the browser entirely is
 * refused BEFORE any account work happens.
 *
 * The provider is bound to an ENABLED stub, exactly as `abuse-limits.e2e-spec.ts`
 * binds it for the 003 login challenge: with the shipped default
 * (`BOT_PROTECTION_ENABLED=false`, the dev-stand and CI state) the guard no-ops
 * by design, and a suite running against a no-op guard would assert nothing.
 * Only the transport is under test here — the challenge verdict belongs to the
 * provider adapter (`smart-captcha.provider.spec.ts`), and the 003 guard itself
 * is unchanged by this Issue.
 */
class StubBotProtection implements BotProtection {
  static readonly GOOD_TOKEN = "good-captcha";
  verify(token: string): Promise<BotProtectionResult> {
    if (!token) return Promise.resolve({ ok: false, reason: "missing-token" });
    return Promise.resolve(
      token === StubBotProtection.GOOD_TOKEN
        ? { ok: true }
        : { ok: false, reason: "rejected" },
    );
  }
}

describe.skipIf(!process.env.DATABASE_URL)(
  "021 EARS-19 doctor registration — bot protection (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const runId = Date.now();
    const createdEmails: string[] = [];
    const PASSWORD = "Aa1!ufficiently-long-pw";
    const URL = "/v1/storefront/doctor/register";
    const TOKEN_HEADER = "x-smartcaptcha-token";

    function uniqueEmail(tag: string): string {
      const email = `ears19-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** The command body the wired storefront form builds (021 EARS-4/5). */
    function payload(email: string) {
      return {
        email,
        password: PASSWORD,
        medicalWorkerDeclaration: true as const,
        consent: [
          {
            purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
            version: MEDICAL_WORKER_DECLARATION_VERSION,
          },
          {
            purpose: PARTNER_DATA_SHARING_PURPOSE,
            version: PARTNER_DATA_SHARING_VERSION,
          },
        ],
      };
    }

    async function accountExists(email: string): Promise<boolean> {
      const { rows } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
        email,
      ]);
      return rows.length > 0;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(BOT_PROTECTION)
        .useValue(new StubBotProtection())
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    }, 60_000);

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-19.7: a submission with NO challenge token is refused, and creates no account", async () => {
      const email = uniqueEmail("tokenless");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: payload(email),
      });

      // The 003 guard, unchanged: a generic 403 carrying the stable code the
      // storefront branches on to state «Подтвердите, что вы не робот.» at form
      // level rather than on a field the doctor did not get wrong.
      expect(res.statusCode).toBe(403);
      expect(res.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.required,
      );
      // Refused BEFORE the handler: a replay that skips the browser buys nothing.
      expect(await accountExists(email)).toBe(false);
    });

    it("EARS-19.7: a submission whose token the provider refuses is rejected, not merely re-challenged", async () => {
      const email = uniqueEmail("stale");

      const res = await app.inject({
        method: "POST",
        url: URL,
        headers: { [TOKEN_HEADER]: "expired-or-forged" },
        payload: payload(email),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.rejected,
      );
      expect(await accountExists(email)).toBe(false);
    });

    it("EARS-19.7: the same command WITH a valid token on the header passes the guard and registers", async () => {
      const email = uniqueEmail("accepted");

      const res = await app.inject({
        method: "POST",
        url: URL,
        headers: { [TOKEN_HEADER]: StubBotProtection.GOOD_TOKEN },
        payload: payload(email),
      });

      // The header is the transport the wired client uses — this is the
      // assertion that pins the two halves together. The body stays exactly the
      // contract schema, with no token field smuggled into it.
      expect(res.statusCode).toBeLessThan(400);
      expect(await accountExists(email)).toBe(true);
    });
  },
);
