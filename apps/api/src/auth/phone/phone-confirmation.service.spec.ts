import { describe, expect, it } from "vitest";
import { BadRequestException, HttpException } from "@nestjs/common";
import { FakeIdpClient, FAKE_VALID_CODE } from "../idp/idp.fake.js";
import { InMemoryAuthAuditLog } from "../session/auth-audit.fake.js";
import { FakeMailer } from "../../mailer/mailer.fake.js";
import { SyntheticSuppression } from "../../mailer/synthetic-suppression.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { DEFAULT_RATE_LIMIT_THRESHOLDS } from "../rate-limit/rate-limit.types.js";
import { SmsBudgetService } from "../sms-budget/sms-budget.service.js";
import { DEFAULT_SMS_BUDGET_THRESHOLDS } from "../sms-budget/sms-budget.types.js";
import { InMemoryPhoneMirror } from "./phone-mirror.js";
import { PhoneConfirmationService } from "./phone-confirmation.service.js";

const SUB = "sub-a";
const OTHER = "sub-b";
const P = "+79161234567";
const Q = "+79169876543";
const CTX = { ip: "203.0.113.7" };

function setup(opts: { suppress?: boolean } = {}) {
  const idp = new FakeIdpClient();
  const mirror = new InMemoryPhoneMirror();
  const audit = new InMemoryAuthAuditLog();
  const mailer = new FakeMailer();
  const now = () => 1_000_000;
  const rateLimit = new RateLimitService(DEFAULT_RATE_LIMIT_THRESHOLDS, now);
  const smsBudget = new SmsBudgetService(DEFAULT_SMS_BUDGET_THRESHOLDS, now);
  const synthetic = new SyntheticSuppression({
    enabled: () => opts.suppress ?? false,
    tags: { domain: "@loadtest.invalid", msisdnPrefix: "+999" },
  });
  const service = new PhoneConfirmationService(
    idp,
    mirror,
    audit,
    mailer,
    synthetic,
    rateLimit,
    smsBudget,
  );
  for (const [sub, email] of [
    [SUB, "a@example.test"],
    [OTHER, "b@example.test"],
  ] as const) {
    idp.seedUser({ sub, email });
    mirror.accounts.set(sub, { email, phone: null, phoneVerified: false });
  }
  const confirmOn = (sub: string, phone: string) => {
    idp.attachPhone(sub, phone);
    const a = mirror.accounts.get(sub)!;
    mirror.accounts.set(sub, { ...a, phone, phoneVerified: true });
  };
  const types = () => audit.events.map((e) => e.type);
  return { idp, mirror, audit, mailer, service, confirmOn, types };
}

describe("PhoneConfirmationService", () => {
  it("EARS-47: a code request normalises the number, sets it unverified at the IdP with an SMS and writes no confirmed phone", async () => {
    const { idp, mirror, service, types } = setup();
    const res = await service.requestCode(SUB, "8 (916) 123-45-67", CTX);
    expect(res).toEqual({ status: "code_sent" });
    expect(idp.phoneCodeRequests).toEqual([
      { sub: SUB, phone: P, delivery: "sms" },
    ]);
    expect((await idp.getUser(SUB))?.phoneVerified).toBe(false);
    expect(mirror.accounts.get(SUB)).toMatchObject({
      phone: null,
      phoneVerified: false,
    });
    expect(types()).toEqual(["PhoneConfirmRequested"]);
  });

  it("EARS-47: a second request for the awaiting number re-sends the code", async () => {
    const { idp, service } = setup();
    await service.requestCode(SUB, P, CTX);
    await service.requestCode(SUB, P, CTX);
    expect(idp.phoneCodeRequests.map((r) => r.phone)).toEqual([P, P]);
  });

  it("EARS-47: the number the account already holds confirmed is a no-op success with no SMS", async () => {
    const { idp, service, confirmOn, types } = setup();
    confirmOn(SUB, P);
    expect(await service.requestCode(SUB, P, CTX)).toEqual({
      status: "already_confirmed",
    });
    expect(idp.phoneCodeRequests).toEqual([]);
    expect(types()).toEqual([]);
  });

  it("EARS-47: every send passes the EARS-14 per-phone limit — the fourth in an hour is the generic throttled response", async () => {
    const { idp, service } = setup();
    for (let i = 0; i < 3; i++) await service.requestCode(SUB, P, CTX);
    await expect(service.requestCode(SUB, P, CTX)).rejects.toMatchObject({
      status: 429,
    });
    expect(idp.phoneCodeRequests).toHaveLength(3);
  });

  it("EARS-47: the EARS-13 per-account limit refuses the eleventh request in 15 minutes", async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i++) {
      await service.requestCode(SUB, `+7916000000${i}`, CTX);
    }
    const err = await service
      .requestCode(SUB, "+79160000099", CTX)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it("EARS-47: a synthetic recipient sets the number without an SMS (EARS-33 suppression)", async () => {
    const { idp, service } = setup({ suppress: true });
    await service.requestCode(SUB, "+99912345678", CTX);
    expect(idp.phoneCodeRequests).toEqual([
      { sub: SUB, phone: "+99912345678", delivery: "none" },
    ]);
  });

  it("EARS-48: the right code writes the IdP-verified phone, appends one confirmed row and sends the notice", async () => {
    const { idp, mirror, mailer, service, types } = setup();
    await service.requestCode(SUB, P, CTX);
    expect(await service.confirm(SUB, ` ${FAKE_VALID_CODE} `)).toEqual({
      status: "confirmed",
      phone: P,
    });
    expect(mirror.accounts.get(SUB)).toMatchObject({
      phone: P,
      phoneVerified: true,
    });
    expect((await idp.getUser(SUB))?.phoneVerified).toBe(true);
    expect(types()).toEqual(["PhoneConfirmRequested", "PhoneConfirmed"]);
    await Promise.resolve();
    expect(mailer.phoneConfirmedNotices.map((n) => n.to)).toEqual([
      "a@example.test",
    ]);
  });

  it("EARS-48: a wrong, malformed or not-awaited code is one generic failure that writes nothing and sends no notice", async () => {
    const { mirror, mailer, service, types } = setup();
    // Nothing awaits a code yet.
    await expect(service.confirm(SUB, FAKE_VALID_CODE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.requestCode(SUB, P, CTX);
    for (const code of ["000000", "12345", "abcdef"]) {
      const err = await service.confirm(SUB, code).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe(
        "the request could not be completed",
      );
    }
    expect(mirror.accounts.get(SUB)?.phone).toBeNull();
    expect(types()).not.toContain("PhoneConfirmed");
    expect(mailer.phoneConfirmedNotices).toEqual([]);
  });

  it("EARS-48: failed confirmations count against the EARS-13 per-account limit", async () => {
    const { service } = setup();
    await service.requestCode(SUB, P, CTX);
    for (let i = 0; i < 9; i++) {
      await service.confirm(SUB, "000000").catch(() => undefined);
    }
    await expect(service.confirm(SUB, FAKE_VALID_CODE)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("EARS-49: requesting a different number displaces the confirmed phone at once and records auth.phone.changed", async () => {
    const { mirror, service, confirmOn, types, idp } = setup();
    confirmOn(SUB, Q);
    await service.requestCode(SUB, P, CTX);
    expect(mirror.accounts.get(SUB)).toMatchObject({
      phone: null,
      phoneVerified: false,
    });
    expect(types()).toEqual(["PhoneChanged", "PhoneConfirmRequested"]);
    // Neither number signs in until the code is entered (EARS-58).
    expect(await idp.getUser(SUB)).toMatchObject({
      phone: P,
      phoneVerified: false,
    });
    await service.confirm(SUB, FAKE_VALID_CODE);
    expect(mirror.accounts.get(SUB)).toMatchObject({
      phone: P,
      phoneVerified: true,
    });
  });

  it("EARS-51: a number confirmed on another account answers like a free number, sends nothing and leaves the requester untouched", async () => {
    const { idp, mirror, service, confirmOn, types } = setup();
    confirmOn(OTHER, P);
    expect(await service.requestCode(SUB, P, CTX)).toEqual({
      status: "code_sent",
    });
    expect(idp.phoneCodeRequests).toEqual([]);
    expect((await idp.getUser(SUB))?.phone).toBeUndefined();
    expect(mirror.accounts.get(SUB)?.phone).toBeNull();
    expect(types()).toEqual([]);
    // The confirm that follows fails like any wrong code.
    await expect(service.confirm(SUB, FAKE_VALID_CODE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("EARS-51: a requester holding a confirmed phone loses it exactly as for a free number — IdP and mirror cleared, no SMS, the taken number written nowhere", async () => {
    const free = setup();
    free.confirmOn(SUB, Q);
    await free.service.requestCode(SUB, P, CTX);

    const taken = setup();
    taken.confirmOn(SUB, Q);
    taken.confirmOn(OTHER, P);
    expect(await taken.service.requestCode(SUB, P, CTX)).toEqual({
      status: "code_sent",
    });

    // The requester's own view (the mirror-backed profile) is the same either way.
    expect(taken.mirror.accounts.get(SUB)).toEqual(
      free.mirror.accounts.get(SUB),
    );
    expect(taken.mirror.accounts.get(SUB)).toMatchObject({
      phone: null,
      phoneVerified: false,
    });
    // The IdP no longer holds Q verified, and never receives P.
    const idpUser = await taken.idp.getUser(SUB);
    expect(idpUser?.phone).toBeUndefined();
    expect(idpUser?.phoneVerified).toBe(false);
    expect(taken.idp.phoneCodeRequests).toEqual([]);
    expect(taken.types()).toContain("PhoneChanged");
    // Q no longer signs in, as after a free-number request (EARS-58).
    expect(await taken.idp.loginWithSmsOtp(Q, FAKE_VALID_CODE)).toBeNull();
  });

  it("EARS-51: a number still awaiting its code is dropped too, so its earlier code no longer confirms", async () => {
    const { idp, mirror, service, confirmOn } = setup();
    await service.requestCode(SUB, Q, CTX);
    confirmOn(OTHER, P);
    await service.requestCode(SUB, P, CTX);
    expect((await idp.getUser(SUB))?.phone).toBeUndefined();
    await expect(service.confirm(SUB, FAKE_VALID_CODE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mirror.accounts.get(SUB)?.phone).toBeNull();
  });

  it("EARS-51: the elsewhere-confirmed request still spends the EARS-14 per-phone limit", async () => {
    const { service, confirmOn } = setup();
    confirmOn(OTHER, P);
    for (let i = 0; i < 3; i++) await service.requestCode(SUB, P, CTX);
    await expect(service.requestCode(SUB, P, CTX)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("EARS-48: a confirmation that loses the UNIQUE race writes nothing, drops the number from the IdP user and answers like a wrong code", async () => {
    const { idp, mirror, mailer, service, types } = setup();
    await service.requestCode(SUB, P, CTX);
    // Another account confirms P between our request and our confirm.
    const b = mirror.accounts.get(OTHER)!;
    mirror.accounts.set(OTHER, { ...b, phone: P, phoneVerified: true });
    await expect(service.confirm(SUB, FAKE_VALID_CODE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mirror.accounts.get(SUB)?.phone).toBeNull();
    // The IdP never keeps a verified number the mirror refused.
    expect((await idp.getUser(SUB))?.phone).toBeUndefined();
    expect(types()).not.toContain("PhoneConfirmed");
    expect(mailer.phoneConfirmedNotices).toEqual([]);
  });

  it("EARS-52: a mailer failure never alters the confirmation response", async () => {
    const { mailer, service } = setup();
    mailer.sendPhoneConfirmedNotice = () => Promise.reject(new Error("smtp"));
    await service.requestCode(SUB, P, CTX);
    await expect(service.confirm(SUB, FAKE_VALID_CODE)).resolves.toEqual({
      status: "confirmed",
      phone: P,
    });
  });

  it("EARS-57: request, change and confirmation rows carry the subject only", async () => {
    const { audit, service, confirmOn } = setup();
    confirmOn(SUB, Q);
    await service.requestCode(SUB, P, CTX);
    await service.confirm(SUB, FAKE_VALID_CODE);
    expect(audit.events).toEqual([
      { type: "PhoneChanged", sub: SUB },
      { type: "PhoneConfirmRequested", sub: SUB },
      { type: "PhoneConfirmed", sub: SUB },
    ]);
  });
});
