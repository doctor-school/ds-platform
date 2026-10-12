import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LIVE_PHONE,
  SMS_LOGIN_EVENT,
  freshPhone,
  liveHarness,
  mailsTo,
  sinkMessages,
  smsCount,
  type LiveHarness,
} from "../support/live-phone.js";

// 003 EARS-58 (#2449): a phone counts as a sign-in / reset identifier only
// while it is confirmed. Zitadel itself matches and notifies an unverified
// phone, so this drives the whole api against the dev-stand Zitadel with a
// number that sits on the IdP user unverified (a code was requested, never
// entered). The mirror-upsert half of EARS-58 is pinned by
// `src/auth/user-mirror.service.spec.ts`.
describe.skipIf(!LIVE_PHONE)("003 EARS-58 unconfirmed phone (live e2e)", () => {
  let h: LiveHarness;

  beforeAll(async () => {
    h = await liveHarness();
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  }, 60_000);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("EARS-58: password sign-in, SMS sign-in and password reset by a number the IdP holds unverified resolve to no account", async () => {
    const a = await h.account("ph58");
    const phone = freshPhone();
    const unknown = freshPhone();
    expect((await h.requestCode(a.headers, phone)).statusCode).toBe(200);
    // The number now sits on the IdP user, unverified.
    for (let i = 0; i < 30; i++) {
      if ((await h.idp.getUser(a.sub))?.phone === phone) break;
      await sleep(250);
    }
    expect(await h.idp.getUser(a.sub)).toMatchObject({
      phone,
      phoneVerified: false,
    });

    // Password sign-in: the same generic refusal as an unknown number.
    const [l1, l2] = [
      await h.passwordLogin(phone),
      await h.passwordLogin(unknown),
    ];
    expect(l1.statusCode).toBe(401);
    expect(l1.body).toBe(l2.body);

    // SMS sign-in: the enumeration-safe ack, and no sign-in code is sent.
    const loginBefore = (
      await sinkMessages(phone, new Date(0).toISOString(), SMS_LOGIN_EVENT)
    ).length;
    const otp = (identifier: string) =>
      h.app.inject({
        method: "POST",
        url: "/v1/auth/login/otp/request",
        payload: { identifier, channel: "sms" },
      });
    const [o1, o2] = [await otp(phone), await otp(unknown)];
    expect(o1.statusCode).toBe(o2.statusCode);
    expect(o1.body).toBe(o2.body);

    // Password reset: the same answer as an unknown number, nothing sent.
    const smsBefore = await smsCount(phone);
    const reset = (identifier: string) =>
      h.app.inject({
        method: "POST",
        url: "/v1/auth/password/reset",
        payload: { identifier },
      });
    const [r1, r2] = [await reset(phone), await reset(unknown)];
    expect(r1.statusCode).toBe(r2.statusCode);
    expect(r1.body).toBe(r2.body);

    await sleep(4000);
    expect(
      (await sinkMessages(phone, new Date(0).toISOString(), SMS_LOGIN_EVENT))
        .length,
    ).toBe(loginBefore);
    expect(await smsCount(phone)).toBe(smsBefore);
    expect(await mailsTo(a.email, "код сброса пароля")).toEqual([]);
    // Email sign-in is unaffected.
    expect((await h.passwordLogin(a.email)).statusCode).toBe(200);
  }, 90_000);
});
