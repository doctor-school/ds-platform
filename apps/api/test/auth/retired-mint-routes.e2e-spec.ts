import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import {
  DEVICE,
  PASSWORD,
  storefrontHarness,
  type StorefrontHarness,
} from "../setup/storefront-harness.js";

/**
 * 003 EARS-8 (amended) / EARS-69 — a storefront session is minted only by
 * the storefront callback's redeem over a live sign-in-host record. The
 * storefront-side credential and code steps that minted an unlinked session
 * of their own are gone: each answers 404 and sets no cookie, so the only
 * way to a session is the sign-in host's step plus the callback.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-8 — no storefront route mints a session of its own (e2e)",
  () => {
    let h: StorefrontHarness;

    beforeAll(async () => {
      h = await storefrontHarness();
    });
    afterAll(async () => {
      await h.close();
    });

    const identifier = "retired-routes@ds.test";
    const retired: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["/v1/auth/login", { identifier, password: PASSWORD }],
      [
        "/v1/auth/login/otp",
        { identifier, code: FAKE_VALID_CODE, channel: "email" },
      ],
      [
        "/v1/auth/password/reset/complete",
        { identifier, code: FAKE_VALID_CODE, newPassword: PASSWORD },
      ],
      ["/v1/auth/verify", { email: identifier, code: FAKE_VALID_CODE }],
      [
        "/v1/storefront/doctor/verify",
        { email: identifier, code: FAKE_VALID_CODE },
      ],
    ];

    for (const [url, payload] of retired) {
      it(`003 EARS-8: POST ${url} answers 404 and sets no cookie`, async () => {
        const res = await h.app.inject({
          method: "POST",
          url,
          headers: DEVICE,
          payload,
        });
        expect(res.statusCode, res.body).toBe(404);
        expect(res.headers["set-cookie"]).toBeUndefined();
      });
    }
  },
);
