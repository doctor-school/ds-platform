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
  DEFAULT_SMS_BUDGET_THRESHOLDS,
  SMS_BUDGET_THRESHOLDS,
} from "../../src/auth/sms-budget/sms-budget.types.js";
import {
  DEFAULT_SYNTHETIC_DOMAIN,
  DEFAULT_SYNTHETIC_MSISDN_PREFIX,
  SYNTHETIC_SUPPRESSION,
  SyntheticSuppression,
} from "../../src/mailer/synthetic-suppression.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 003 EARS-33 (design §14.8): synthetic-send suppression seam for the #873
// load-test, exercised over the real HTTP surface with the IdP bound to the
// in-memory fake and the suppression toggle forced ON. It proves the SMS send
// point drops a reserved-test-MSISDN (`+999…`) recipient BEFORE the Zitadel/
// SMS-Aero provider hop (the fake's `smsOtpSendCount()` stays 0) — AFTER the
// EARS-14 budget the load test must exercise — while the enumeration-safe
// `otp_sent` ack is unchanged (EARS-16); an untagged real phone still sends.
describe.skipIf(!process.env.DATABASE_URL)(
  "Synthetic-send suppression (e2e, 003 EARS-33)",
  () => {
    let app: NestFastifyApplication;
    let idp: FakeIdpClient;

    async function boot(): Promise<void> {
      idp = new FakeIdpClient();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
        // Force the load-test suppression toggle ON for this app instance.
        .overrideProvider(SYNTHETIC_SUPPRESSION)
        .useValue(
          new SyntheticSuppression({
            enabled: () => true,
            tags: {
              domain: DEFAULT_SYNTHETIC_DOMAIN,
              msisdnPrefix: DEFAULT_SYNTHETIC_MSISDN_PREFIX,
            },
          }),
        )
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
    }

    beforeAll(boot);
    afterAll(async () => {
      await app.close();
    });

    it("003 EARS-33: an SMS-OTP request to a reserved test-MSISDN is suppressed before the provider hop (zero send), ack unchanged", async () => {
      const before = idp.smsOtpSendCount();

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: "+9991234567", channel: "sms" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "otp_sent" }); // enumeration-safe (EARS-16)
      expect(idp.smsOtpSendCount()).toBe(before); // ZERO real send left the box
    });

    it("003 EARS-33: an SMS-OTP request to an untagged real phone still reaches the provider", async () => {
      const before = idp.smsOtpSendCount();

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier: "+79995551234", channel: "sms" },
      });

      expect(res.statusCode).toBe(200);
      expect(idp.smsOtpSendCount()).toBe(before + 1);
    });
  },
);
