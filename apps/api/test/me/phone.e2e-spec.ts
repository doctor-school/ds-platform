import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConfirmPhoneResponseSchema,
  MyProfileSchema,
  RequestPhoneCodeResponseSchema,
} from "@ds/schemas";
import { readPhoneCodeRequestTimingFloorMs } from "../../src/auth/phone/phone-timing.js";
import {
  LIVE_PHONE,
  expectNoNewSms,
  smsCount,
  freshPhone,
  liveHarness,
  mailBody,
  mailsTo,
  phoneCode,
  type LiveHarness,
} from "../support/live-phone.js";

// 003 EARS-47/48/49/51/52/57 (#2449): confirming a phone from `/account`
// against the dev-stand Zitadel, its SMS provider chain into `sms-sink`, and
// Mailpit. Skips without the live IdP env (the shared CI job).
const NOTICE_SUBJECT = "в аккаунте подтверждён номер телефона";

describe.skipIf(!LIVE_PHONE)("003 phone confirmation (live e2e)", () => {
  let h: LiveHarness;

  beforeAll(async () => {
    h = await liveHarness();
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  }, 60_000);

  async function mirror(sub: string) {
    const { rows } = await h.pool.query<{
      phone: string | null;
      phone_verified: boolean;
    }>(`SELECT phone, phone_verified FROM users WHERE zitadel_sub = $1`, [sub]);
    return rows[0];
  }

  async function ledger(sub: string): Promise<string[]> {
    const { rows } = await h.pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_ledger
        WHERE subject_id = $1 AND event_type LIKE 'auth.phone.%'
        ORDER BY created_at, id`,
      [sub],
    );
    return rows.map((r) => r.event_type);
  }

  /** Request + confirm `phone` on the account; returns the code used. */
  async function confirmPhone(
    headers: Record<string, string>,
    phone: string,
  ): Promise<void> {
    const at = new Date().toISOString();
    expect((await h.requestCode(headers, phone)).statusCode).toBe(200);
    const res = await h.confirm(headers, await phoneCode(phone, at));
    expect(res.statusCode, res.body).toBe(200);
  }

  it("EARS-47: a code request sends a six-digit SMS through the provider chain, sets nothing confirmed and records auth.phone.confirm.requested", async () => {
    const a = await h.account("ph47");
    const phone = freshPhone();
    const at = new Date().toISOString();
    const res = await h.requestCode(a.headers, phone);
    expect(res.statusCode).toBe(200);
    expect(RequestPhoneCodeResponseSchema.parse(res.json())).toEqual({
      status: "code_sent",
    });
    // The code is only in the SMS, never in the response.
    const code = await phoneCode(phone, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(res.body).not.toContain(code);
    expect(await mirror(a.sub)).toEqual({ phone: null, phone_verified: false });
    expect(await ledger(a.sub)).toEqual(["auth.phone.confirm.requested"]);
    // EARS-14: the per-phone limit (3/h) refuses the fourth send generically.
    await h.requestCode(a.headers, phone);
    await h.requestCode(a.headers, phone);
    const fourth = await h.requestCode(a.headers, phone);
    expect(fourth.statusCode).toBe(429);
  }, 90_000);

  it("EARS-48: the right code confirms the number at the IdP and in the mirror, records auth.phone.confirmed and sends one notice (EARS-52)", async () => {
    const a = await h.account("ph48");
    const phone = freshPhone();
    const at = new Date().toISOString();
    await h.requestCode(a.headers, phone);
    const code = await phoneCode(phone, at);

    // Wrong codes first: one generic failure each, nothing written, no notice.
    for (const wrong of [code === "000000" ? "111111" : "000000", "12ab56"]) {
      const bad = await h.confirm(a.headers, wrong);
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({
        message: "the request could not be completed",
      });
    }
    expect(await mirror(a.sub)).toEqual({ phone: null, phone_verified: false });

    const ok = await h.confirm(a.headers, ` ${code} `);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ConfirmPhoneResponseSchema.parse(ok.json())).toEqual({
      status: "confirmed",
      phone,
    });
    expect(await mirror(a.sub)).toEqual({ phone, phone_verified: true });
    expect((await h.idp.getUser(a.sub))?.phoneVerified).toBe(true);
    expect(await ledger(a.sub)).toEqual([
      "auth.phone.confirm.requested",
      "auth.phone.confirmed",
    ]);
    const profile = MyProfileSchema.parse(
      (
        await h.app.inject({
          method: "GET",
          url: "/v1/me/profile",
          headers: a.headers,
        })
      ).json(),
    );
    expect(profile).toMatchObject({ phone, phoneVerified: true });

    // A used code does not confirm again.
    expect((await h.confirm(a.headers, code)).statusCode).toBe(400);

    // EARS-52: one notice, no code, no number, no link.
    let notices: { Subject: string; ID: string }[] = [];
    for (let i = 0; i < 20 && notices.length === 0; i++) {
      notices = await mailsTo(a.email, NOTICE_SUBJECT);
      if (notices.length === 0) await new Promise((r) => setTimeout(r, 500));
    }
    expect(notices).toHaveLength(1);
    const body = await mailBody(notices[0]!.ID);
    expect(body.Text).not.toContain(code);
    expect(body.Text).not.toContain(phone.slice(-7));
    expect(body.HTML).not.toMatch(/<a\s/i);
  }, 90_000);

  it("EARS-49: a request for a different number displaces the confirmed phone at once; neither number signs in until the new code is entered", async () => {
    const a = await h.account("ph49");
    const oldPhone = freshPhone();
    await confirmPhone(a.headers, oldPhone);
    expect((await h.passwordLogin(oldPhone)).statusCode).toBe(200);

    const newPhone = freshPhone();
    const at = new Date().toISOString();
    expect((await h.requestCode(a.headers, newPhone)).statusCode).toBe(200);
    expect(await mirror(a.sub)).toEqual({ phone: null, phone_verified: false });
    expect(await ledger(a.sub)).toEqual([
      "auth.phone.confirm.requested",
      "auth.phone.confirmed",
      "auth.phone.changed",
      "auth.phone.confirm.requested",
    ]);
    // EARS-58: neither number names the account while the change is open;
    // email sign-in is unaffected.
    expect((await h.passwordLogin(oldPhone)).statusCode).toBe(401);
    expect((await h.passwordLogin(newPhone)).statusCode).toBe(401);
    expect((await h.passwordLogin(a.email)).statusCode).toBe(200);

    expect(
      (await h.confirm(a.headers, await phoneCode(newPhone, at))).statusCode,
    ).toBe(200);
    expect(await mirror(a.sub)).toEqual({
      phone: newPhone,
      phone_verified: true,
    });
    expect((await h.passwordLogin(newPhone)).statusCode).toBe(200);
    expect((await h.passwordLogin(oldPhone)).statusCode).toBe(401);
  }, 120_000);

  it("EARS-47: a request for the number already confirmed on the account is a no-op success with no SMS", async () => {
    const a = await h.account("ph47noop");
    const phone = freshPhone();
    await confirmPhone(a.headers, phone);
    const before = await smsCount(phone);
    const res = await h.requestCode(a.headers, phone);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "already_confirmed" });
    await expectNoNewSms(phone, before);
    expect(await mirror(a.sub)).toEqual({ phone, phone_verified: true });
  }, 90_000);

  it("EARS-51: a number confirmed on another account gets the free-number answer, no SMS, no change to the requester, and the confirm fails generically", async () => {
    const owner = await h.account("ph51own");
    const taken = freshPhone();
    await confirmPhone(owner.headers, taken);

    const a = await h.account("ph51req");

    const freeAt = new Date().toISOString();
    const free = freshPhone();
    const t0 = Date.now();
    const freeRes = await h.requestCode(a.headers, free);
    const freeMs = Date.now() - t0;
    await phoneCode(free, freeAt);

    // A second clean requester asks for the number confirmed elsewhere.
    const b = await h.account("ph51req2");
    const bBefore = await h.idp.getUser(b.sub);
    const takenBefore = await smsCount(taken);
    const t1 = Date.now();
    const takenRes = await h.requestCode(b.headers, taken);
    const takenMs = Date.now() - t1;

    expect(takenRes.statusCode).toBe(freeRes.statusCode);
    expect(takenRes.body).toBe(freeRes.body);
    expect(takenRes.headers["content-type"]).toBe(
      freeRes.headers["content-type"],
    );
    // Both answers are floored (EARS-16 timing).
    const floorMs = readPhoneCodeRequestTimingFloorMs();
    expect(freeMs).toBeGreaterThanOrEqual(floorMs - 20);
    expect(takenMs).toBeGreaterThanOrEqual(floorMs - 20);

    await expectNoNewSms(taken, takenBefore);
    expect((await h.idp.getUser(b.sub))?.phone).toBe(bBefore?.phone);
    expect(await mirror(b.sub)).toEqual({ phone: null, phone_verified: false });
    expect(await ledger(b.sub)).toEqual([]);
    const confirm = await h.confirm(b.headers, "123456");
    expect(confirm.statusCode).toBe(400);
    expect(confirm.json()).toMatchObject({
      message: "the request could not be completed",
    });
    // The owner keeps the number.
    expect(await mirror(owner.sub)).toEqual({
      phone: taken,
      phone_verified: true,
    });
  }, 120_000);

  it("EARS-51: a requester holding a confirmed phone loses it exactly as for a free number when it asks for a number confirmed elsewhere — no SMS, the taken number written nowhere", async () => {
    const owner = await h.account("ph51dispown");
    const taken = freshPhone();
    await confirmPhone(owner.headers, taken);

    const a = await h.account("ph51disp");
    const own = freshPhone();
    await confirmPhone(a.headers, own);
    const takenBefore = await smsCount(taken);

    expect((await h.requestCode(a.headers, taken)).statusCode).toBe(200);

    // The same own view as the EARS-49 free-number displacement.
    expect(await mirror(a.sub)).toEqual({ phone: null, phone_verified: false });
    expect(await ledger(a.sub)).toEqual([
      "auth.phone.confirm.requested",
      "auth.phone.confirmed",
      "auth.phone.changed",
    ]);
    expect((await h.passwordLogin(own)).statusCode).toBe(401);
    expect((await h.passwordLogin(a.email)).statusCode).toBe(200);
    // The IdP holds no phone for the requester — never the taken number.
    expect((await h.idp.getUser(a.sub))?.phone).toBeUndefined();
    await expectNoNewSms(taken, takenBefore);
    expect(await mirror(owner.sub)).toEqual({
      phone: taken,
      phone_verified: true,
    });
  }, 120_000);

  it("EARS-51: the anonymous sign-in and reset answers do not change with a confirmed phone", async () => {
    const owner = await h.account("ph51anon");
    const phone = freshPhone();
    const unknown = freshPhone();
    await confirmPhone(owner.headers, phone);

    const reset = (identifier: string) =>
      h.app.inject({
        method: "POST",
        url: "/v1/auth/password/reset",
        payload: { identifier },
      });
    const [r1, r2] = [await reset(phone), await reset(unknown)];
    expect(r1.statusCode).toBe(r2.statusCode);
    expect(r1.body).toBe(r2.body);
    const wrong = (identifier: string) =>
      h.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { identifier, password: "Wrong-password-1!" },
        headers: { "user-agent": "Test/1.0" },
      });
    const [w1, w2] = [await wrong(phone), await wrong(unknown)];
    expect(w1.statusCode).toBe(w2.statusCode);
    expect(w1.body).toBe(w2.body);
    // The sink only ever sees the confirmation SMS of the owner here.
    expect(await smsCount(unknown)).toBe(0);
  }, 120_000);
});
