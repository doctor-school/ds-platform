import { describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "./idp/idp.fake.js";
import {
  IdpInvalidArgumentError,
  IdpPasswordPolicyError,
  IdpUnavailableError,
  type IdpClient,
} from "./idp/idp.types.js";
import type { RegisterRequest } from "@ds/schemas";
import { consentRecords, users } from "@ds/db";
import { InMemoryAuthAuditLog } from "./session/auth-audit.fake.js";
import { InMemorySessionStore } from "./session/session-store.fake.js";
import { SessionService } from "./session/session.service.js";
import { parseCookies, SESSION_COOKIE_NAME } from "./session/session.cookie.js";
import { FakeMailer } from "../mailer/mailer.fake.js";
import {
  InMemoryRegisterNoticeThrottle,
  type RegisterNoticeThrottle,
} from "../mailer/register-notice-throttle.js";
import type { Mailer } from "../mailer/mailer.types.js";
import { SyntheticSuppression } from "../mailer/synthetic-suppression.js";

// AuthService.register error taxonomy (no DB). Registration is email-primary
// (#202): the creation schema rejects baseline-violating passwords at the DTO
// layer before any IdP round-trip, so these specs prove the *residual* IdP-side
// rejections — each mapped to an enumeration-safe response, NEVER a bare 500:
//   - IdpPasswordPolicyError    → generic 422 "weak password"   (#147)
//   - IdpInvalidArgumentError   → generic 400 (deterministic 4xx) (#202)
//   - IdpUnavailableError       → 503 "unavailable" (5xx/net)      (#202)

/** Minimal IdpClient whose createUser always rejects with `err`; anything else throws if hit. */
function createUserRejectingIdp(err: Error): IdpClient {
  const base = new FakeIdpClient() as unknown as IdpClient;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "createUser") {
        return () => Promise.reject(err);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// The DB must never be touched on an IdP create-rejection path (the throw happens
// before any mirror/consent write); a Proxy that throws on any access proves it.
const explodingDb = new Proxy(
  {},
  {
    get() {
      throw new Error("db must not be touched on an IdP create rejection");
    },
  },
);

function buildService(idp: IdpClient): AuthService {
  return new AuthService(
    idp,
    explodingDb as never,
    undefined,
    { record: () => Promise.resolve() } as never,
    new InMemoryRegisterNoticeThrottle("test-pepper"),
    SyntheticSuppression.disabled(),
    {} as never,
    {} as never,
    {} as never,
  );
}

const consent = [{ purpose: "tos", version: "2026-01" }];
const req: RegisterRequest = {
  email: "user@ds.test",
  password: "Aa1!aaaa",
  consent,
};

describe("AuthService.register — IdP create-rejection taxonomy (#147, #202)", () => {
  it("#147: maps IdpPasswordPolicyError to a generic 422 (not a 500)", async () => {
    const service = buildService(
      createUserRejectingIdp(new IdpPasswordPolicyError()),
    );
    const err = await service.register(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getStatus()).toBe(422);
  });

  it("#202: maps a deterministic IdpInvalidArgumentError to a generic 400, NEVER a 500", async () => {
    const service = buildService(
      createUserRejectingIdp(new IdpInvalidArgumentError()),
    );
    const err = await service.register(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
  });

  it("#202: maps a genuine IdpUnavailableError (5xx/net) to a 503, NEVER a 500", async () => {
    const service = buildService(
      createUserRejectingIdp(new IdpUnavailableError()),
    );
    const err = await service.register(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getStatus()).toBe(503);
  });

  it("#147/#16: the 422 is identical for any two email registrants (no existence oracle)", async () => {
    const service = buildService(
      createUserRejectingIdp(new IdpPasswordPolicyError()),
    );
    const aErr = await service
      .register({ email: "a@ds.test", password: "Aa1!aaaa", consent })
      .catch((e: unknown) => e);
    const bErr = await service
      .register({ email: "b@ds.test", password: "Aa1!aaaa", consent })
      .catch((e: unknown) => e);

    expect(aErr).toBeInstanceOf(UnprocessableEntityException);
    expect(bErr).toBeInstanceOf(UnprocessableEntityException);
    expect((aErr as UnprocessableEntityException).getResponse()).toEqual(
      (bErr as UnprocessableEntityException).getResponse(),
    );
  });
});

// #202 fake/real parity (the regression net): the in-memory FakeIdpClient must be
// no more permissive than real Zitadel, which hard-rejects a human-user create
// with no email. So the fake's createUser rejects a no-email create with the same
// typed IdpInvalidArgumentError the real adapter raises — guaranteeing the
// service's robustness mapping is exercised by the fake too, and a future
// phone-only-registration regression fails in unit tests, not only live.
describe("FakeIdpClient.createUser — no-email parity with real Zitadel (#202)", () => {
  it("rejects a phone-only (no email) create with IdpInvalidArgumentError", async () => {
    const idp = new FakeIdpClient();
    await expect(
      idp.createUser({ phone: "+19998887777", password: "Aa1!aaaaaa" }),
    ).rejects.toBeInstanceOf(IdpInvalidArgumentError);
  });

  it("still accepts an email create, and records the terminal Registered audit row (channel email)", async () => {
    // Drive the email happy path through register() with a stub DB to confirm the
    // email-only cascade still emits exactly one terminal Registered (channel
    // email) — the #202 audit channel is always email now.
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const insertChain = {
      values: () => insertChain,
      onConflictDoUpdate: () => insertChain,
      returning: () => Promise.resolve([{ id: "stub-user-id" }]),
      then: (resolve: (v: unknown) => void) => resolve(undefined),
    };
    const stubDb = {
      transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: () => insertChain }),
    };
    const service = new AuthService(
      idp,
      stubDb as never,
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      {} as never,
      {} as never,
      {} as never,
    );

    const res = await service.register({
      email: "ears1@ds.test",
      password: "Aa1!ufficiently-long-pw",
      consent,
    });

    expect(res).toEqual({ status: "pending_verification" });
    expect(audit.events).toEqual([
      {
        type: "Registered",
        sub: expect.stringMatching(/^fake-sub-/),
        channel: "email",
        consent: [{ purpose: "tos", version: "2026-01" }],
      },
    ]);
  });
});

// 003 EARS-23: re-registration onto an existing account. The `alreadyExisted`
// branch returns the IDENTICAL `pending_verification` and writes nothing; the
// owner receives, privately and fire-and-forget, the code EARS-34 would issue
// in the re-registration mail, throttled per address.

/** A stub DB whose insert/transaction chain succeeds (the new-account branch writes). */
function makeStubDb() {
  const insertChain = {
    values: () => insertChain,
    onConflictDoUpdate: () => insertChain,
    returning: () => Promise.resolve([{ id: "stub-user-id" }]),
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  };
  return { transaction: (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ insert: () => insertChain }) };
}

/** Let the fire-and-forget notice chain settle (it runs off the response path). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildRegisterService(opts: {
  idp: FakeIdpClient;
  audit: InMemoryAuthAuditLog;
  mailer: Mailer;
  throttle: RegisterNoticeThrottle;
}): AuthService {
  return new AuthService(
    opts.idp as unknown as IdpClient,
    makeStubDb() as never,
    undefined,
    opts.audit,
    opts.throttle,
    SyntheticSuppression.disabled(),
    {} as never,
    {} as never,
    {} as never,
  );
}

describe("AuthService.register — re-registration code mail (003 EARS-23)", () => {
  const reg: RegisterRequest = {
    email: "owner@ds.test",
    password: "Aa1!sufficiently-long",
    consent,
  };

  function build(mailer: Mailer = new FakeMailer()) {
    const idp = new FakeIdpClient(mailer);
    const audit = new InMemoryAuthAuditLog();
    const service = buildRegisterService({
      idp,
      audit,
      mailer,
      throttle: new InMemoryRegisterNoticeThrottle("test-pepper"),
    });
    return { idp, audit, service };
  }

  it("003 EARS-23: when a register targets a NEW email, the system shall send no re-registration mail", async () => {
    const mailer = new FakeMailer();
    const { service } = build(mailer);

    const res = await service.register(reg);
    await flushMicrotasks();

    expect(res).toEqual({ status: "pending_verification" });
    expect(mailer.reRegistrationCodeEmails).toEqual([]);
  });

  it("003 EARS-23: when a register targets an UNVERIFIED registered email, the system shall send one code mail saying the password will be saved after the code", async () => {
    const mailer = new FakeMailer();
    const { service, audit } = build(mailer);
    await service.register(reg);
    await flushMicrotasks();

    const res = await service.register(reg);
    await flushMicrotasks();

    expect(res).toEqual({ status: "pending_verification" });
    expect(mailer.reRegistrationCodeEmails).toEqual([
      {
        to: "owner@ds.test",
        code: FAKE_VALID_CODE,
        lifetime: "1h",
        passwordKept: false,
      },
    ]);
    expect(audit.events.filter((e) => e.type === "OtpSent")).toEqual([
      { type: "OtpSent", identifier: "owner@ds.test", channel: "email" },
    ]);
  });

  it("003 EARS-23: when a register targets a VERIFIED email with a password, the mail carries the login code and «Ваш пароль не изменился»", async () => {
    const mailer = new FakeMailer();
    const { service, idp } = build(mailer);
    const created = await idp.createUser({
      email: reg.email,
      password: reg.password,
    });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);

    await service.register(reg);
    await flushMicrotasks();

    expect(mailer.reRegistrationCodeEmails).toEqual([
      {
        to: "owner@ds.test",
        code: FAKE_VALID_CODE,
        lifetime: "5m",
        passwordKept: true,
      },
    ]);
  });

  it("003 EARS-23: when a duplicate register repeats within the throttle window, the second code mail shall be suppressed", async () => {
    const mailer = new FakeMailer();
    const { service } = build(mailer);

    await service.register(reg); // new account
    await service.register(reg); // duplicate → mail #1
    await service.register(reg); // duplicate → throttled
    await flushMicrotasks();

    expect(mailer.reRegistrationCodeEmails).toHaveLength(1);
  });

  it("003 EARS-23: the already-existed branch shall write no account, consent or auth.register row before a code is accepted", async () => {
    const { service, audit } = build();

    await service.register(reg); // new account → one Registered row
    await service.register(reg); // duplicate → no Registered row
    await flushMicrotasks();

    expect(audit.events.filter((e) => e.type === "Registered")).toEqual([
      {
        type: "Registered",
        sub: expect.stringMatching(/^fake-sub-/),
        channel: "email",
        consent: [{ purpose: "tos", version: "2026-01" }],
      },
    ]);
  });

  it("003 EARS-23: when the code mail send rejects, the duplicate-register response shall stay identical and not throw", async () => {
    const exploding: Mailer = {
      sendReRegistrationCodeEmail: () =>
        Promise.reject(new Error("smtp down")),
      sendVerificationCodeEmail: () =>
        Promise.reject(new Error("smtp down")),
      sendPasswordResetCodeEmail: () =>
        Promise.reject(new Error("smtp down")),
      sendAdminLockoutNotice: () => Promise.reject(new Error("smtp down")),
      sendLoginCodeEmail: () => Promise.reject(new Error("smtp down")),
      sendCongressRegistrationConfirmation: () =>
        Promise.reject(new Error("smtp down")),
      sendCongressSubmissionReceipt: () =>
        Promise.reject(new Error("smtp down")),
    };
    const { service } = build(exploding);

    await service.register(reg); // new account
    const res = await service.register(reg); // duplicate → mail rejects
    await flushMicrotasks();

    expect(res).toEqual({ status: "pending_verification" });
  });
});

// #221 (EARS-12): a completed password reset now AUTO-LOGS-IN the subject — it
// keeps the global force-logout (every prior session revoked) + the
// `PasswordResetCompleted` audit, then mints a FRESH authenticated session and
// returns its `__Host-` cookie (mirroring the login session-creation path,
// including its session-created `LoginSucceeded` audit row and the token-free
// body, EARS-8). A bad/expired code or unknown identifier stays the same generic
// failure (no existence oracle, EARS-16). Exercised at the service altitude over
// the fake IdP + in-memory store + audit (no Postgres, no HTTP).
describe("AuthService.completePasswordReset — auto-login (#221, EARS-12)", () => {
  const email = "reset-victim@ds.test";
  const oldPassword = "Aa1!old-sufficiently-long";
  const newPassword = "Aa1!new-sufficiently-long";
  const fingerprint = "fp-reset-device";

  /** A full AuthService wired to a real SessionService over fakes. */
  async function buildResetService(): Promise<{
    service: AuthService;
    idp: FakeIdpClient;
    store: InMemorySessionStore;
    audit: InMemoryAuthAuditLog;
    sub: string;
  }> {
    const idp = new FakeIdpClient();
    const created = await idp.createUser({ email, password: oldPassword });
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const sessions = new SessionService(idp, store, audit);
    const service = new AuthService(
      idp,
      explodingDb as never, // the reset path touches no DB
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      // EARS-35 (#1131): a completed reset now marks the email verified, mirroring
      // the flip onto the users row — so the reset path DOES touch the mirror.
      { markEmailVerified: () => Promise.resolve() } as never,
      sessions,
      {} as never, // smsBudget — unused on the reset path
    );
    return { service, idp, store, audit, sub: created.sub };
  }

  /** Establish a live session for the subject via the password-login path. */
  async function establishExisting(
    idp: FakeIdpClient,
    sessions: SessionService,
  ): Promise<string> {
    const login = await idp.passwordLogin(email, oldPassword);
    if (login.outcome !== "authenticated") throw new Error("login setup failed");
    const { cookie } = await sessions.establish(login.session, fingerprint);
    return parseCookies(cookie)[SESSION_COOKIE_NAME] as string;
  }

  it("EARS-12: when a reset completes, the system shall mint a fresh session and return its __Host- cookie", async () => {
    const { service, store } = await buildResetService();

    await service.requestPasswordReset(email);
    const result = await service.completePasswordReset(
      email,
      FAKE_VALID_CODE,
      newPassword,
      fingerprint,
    );

    // Token-free body (EARS-8) — the status is unchanged…
    expect(result.body).toEqual({ status: "reset_completed" });
    // …and a real __Host- session cookie is returned to set.
    expect(result.cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(result.cookie).toContain("__Host-");
    // The cookie's sid resolves to a live, authenticated server-side session.
    const sid = parseCookies(result.cookie)[SESSION_COOKIE_NAME] as string;
    const record = await store.get(sid);
    expect(record).toBeDefined();
  });

  it("EARS-12: the minted session emits a session-created LoginSucceeded row alongside PasswordResetCompleted", async () => {
    const { service, audit, sub } = await buildResetService();

    await service.requestPasswordReset(email);
    await service.completePasswordReset(
      email,
      FAKE_VALID_CODE,
      newPassword,
      fingerprint,
    );

    // Force-logout audit is preserved…
    expect(audit.events).toContainEqual({ type: "PasswordResetCompleted", sub });
    // …and the new session records the same session-created row as login.
    expect(audit.events).toContainEqual({
      type: "LoginSucceeded",
      sub,
      method: "password",
    });
  });

  it("EARS-12: prior sessions are still globally revoked before the fresh one is minted", async () => {
    const { service, idp, store } = await buildResetService();
    const sessions = new SessionService(idp, store, new InMemoryAuthAuditLog());
    // Two live sessions for the subject (two devices).
    const sidA = await establishExisting(idp, sessions);
    const sidB = await establishExisting(idp, sessions);
    expect(await store.get(sidA)).toBeDefined();
    expect(await store.get(sidB)).toBeDefined();

    await service.requestPasswordReset(email);
    const result = await service.completePasswordReset(
      email,
      FAKE_VALID_CODE,
      newPassword,
      fingerprint,
    );

    // Both prior sessions are gone (global force-logout)…
    expect(await store.get(sidA)).toBeUndefined();
    expect(await store.get(sidB)).toBeUndefined();
    // …while the freshly-minted post-reset session is live.
    const freshSid = parseCookies(result.cookie)[SESSION_COOKIE_NAME] as string;
    expect(await store.get(freshSid)).toBeDefined();
  });

  it("EARS-12: a bad/expired code stays a generic 400 (the throw precedes any session mint — no oracle)", async () => {
    const { service } = await buildResetService();
    await service.requestPasswordReset(email);

    const err = await service
      .completePasswordReset(email, "000000", newPassword, fingerprint)
      .catch((e: unknown) => e);
    // The generic 400 fires before any session-establishment, so no cookie and
    // no session can leak on the failure path (EARS-16 unchanged).
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
  });

  it("EARS-12: normalizes a lowercase, whitespace-padded reset code to trimmed-uppercase before the IdP call (#1109)", async () => {
    // The Zitadel reset code is UPPERCASE alphanumeric and its `!=` compare is
    // case-sensitive with no trim (#1109). A doctor who types the code lowercased
    // — or whose keyboard/autofill pads it — must still succeed: the BFF trims and
    // uppercases before the IdP hop. The generic-400 outcome here is irrelevant
    // (the fake's only valid code is FAKE_VALID_CODE); we assert the NORMALIZED
    // argument the IdP port receives, which the pre-fix pass-through cannot produce.
    const { service, idp } = await buildResetService();
    const spy = vi.spyOn(idp, "completePasswordReset");

    await service
      .completePasswordReset(email, "  pvdc3r  ", newPassword, fingerprint)
      .catch(() => undefined);

    expect(spy).toHaveBeenCalledWith(email, "PVDC3R", newPassword);
  });
});

// EARS-25 (#319): resend the registration email verification code,
// enumeration-safely. A code is re-issued ONLY for an existing, UNVERIFIED
// registrant; an unknown identifier or an already-verified one is a silent no-op.
// The response (`resend_requested`), status, and timing are identical on every
// path (EARS-16) — and the `otp.sent` ledger row (EARS-18) is appended ONLY when
// a code was actually issued, so the ledger is not an existence oracle. Exercised
// at the service altitude over the fake IdP + in-memory audit (no DB, no HTTP).
describe("AuthService.resendEmailVerification — enumeration-safe (#319, EARS-25)", () => {
  const password = "Aa1!sufficiently-long-pw";

  /** A service wired with only the deps the resend path uses (idp + audit). */
  function buildResendService(idp: FakeIdpClient, audit: InMemoryAuthAuditLog) {
    return new AuthService(
      idp as unknown as IdpClient,
      explodingDb as never, // the resend path touches no DB
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      {} as never, // mirror — unused on the resend path
      {} as never, // sessions — unused on the resend path
      {} as never, // smsBudget — unused on the resend path
    );
  }

  it("EARS-25: when an existing, unverified registrant requests a resend, the system shall re-issue the code and append exactly one otp.sent row", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const email = "unverified@ds.test";
    await idp.createUser({ email, password }); // unverified (no verifyEmail)
    const service = buildResendService(idp, audit);

    const res = await service.resendEmailVerification(email);

    expect(res).toEqual({ status: "resend_requested" });
    expect(audit.events).toEqual([
      { type: "OtpSent", identifier: email, channel: "email" },
    ]);
  });

  it("EARS-25/16: an unknown identifier yields the identical ack with NO code and NO ledger row", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const service = buildResendService(idp, audit);

    const res = await service.resendEmailVerification("nobody@ds.test");

    // Identical body to the real-send path (no existence oracle, EARS-16)…
    expect(res).toEqual({ status: "resend_requested" });
    // …but no code was issued, so the ledger stays empty (not an oracle).
    expect(audit.events).toEqual([]);
  });

  it("EARS-25/16: an ALREADY-VERIFIED registrant yields the identical ack with NO code and NO ledger row", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const email = "verified@ds.test";
    const created = await idp.createUser({ email, password });
    // Flip the registrant to verified (mirrors a completed EARS-3 verify).
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    const service = buildResendService(idp, audit);

    const res = await service.resendEmailVerification(email);

    expect(res).toEqual({ status: "resend_requested" });
    // A verified registrant has no pending verification — no send, no row.
    expect(audit.events).toEqual([]);
  });
});

// EARS-25 (#319): the FakeIdpClient.resendEmailVerification must be NO MORE
// PERMISSIVE than the real Zitadel adapter — it re-issues a code (resolves `true`)
// ONLY for an existing, UNVERIFIED registrant, exactly the unverified-vs-verified
// distinction the real adapter draws off `human.email.isVerified`. A fake that
// returned `true` for an unknown or already-verified identifier would hide a
// broken vertical (memory: fake-no-more-permissive).
describe("FakeIdpClient.resendEmailVerification — parity with real adapter (#319, EARS-25)", () => {
  const password = "Aa1!sufficiently-long-pw";

  it("resolves true for an existing, unverified registrant", async () => {
    const idp = new FakeIdpClient();
    await idp.createUser({ email: "u@ds.test", password });
    await expect(idp.resendEmailVerification("u@ds.test")).resolves.toBe(true);
  });

  it("resolves false (no send) for an unknown identifier", async () => {
    const idp = new FakeIdpClient();
    await expect(idp.resendEmailVerification("nobody@ds.test")).resolves.toBe(
      false,
    );
  });

  it("resolves false (no send) for an already-verified registrant", async () => {
    const idp = new FakeIdpClient();
    const created = await idp.createUser({ email: "v@ds.test", password });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    await expect(idp.resendEmailVerification("v@ds.test")).resolves.toBe(false);
  });
});

// 003 EARS-33 (design §14.8): the SMS-OTP send point honours the synthetic-send
// suppression seam. With the toggle ON and a reserved test-MSISDN (`+999…`)
// recipient, the BFF drops the send BEFORE the Zitadel/SMS-Aero provider hop —
// AFTER the EARS-14 budget (the request-shape pipeline the #873 load test must
// exercise) — so zero synthetic SMS leaves the box, while the enumeration-safe
// `otp_sent` ack + the `OtpSent` audit row stay unchanged. Toggle OFF (default) or
// an untagged real phone ⇒ normal send (the provider IS asked).
describe("AuthService.requestLoginOtp — SMS synthetic-send suppression (003 EARS-33)", () => {
  const allowingBudget = { tryConsume: () => true } as never;
  const okAudit = { record: () => Promise.resolve() } as never;

  function buildOtpService(synthetic: SyntheticSuppression, idp: FakeIdpClient) {
    return new AuthService(
      idp as unknown as IdpClient,
      explodingDb as never, // the otp-request path touches no DB
      undefined,
      okAudit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      synthetic,
      {} as never, // mirror — unused
      {} as never, // sessions — unused
      allowingBudget, // smsBudget — always allows here
    );
  }

  const enabled = () =>
    new SyntheticSuppression({
      enabled: () => true,
      tags: { domain: "@loadtest.invalid", msisdnPrefix: "+999" },
    });

  it("003 EARS-33: ON + reserved test-MSISDN → the provider SMS send is NOT called", async () => {
    const idp = new FakeIdpClient();
    const service = buildOtpService(enabled(), idp);

    const res = await service.requestLoginOtp(
      { identifier: "+9991234567", channel: "sms" },
      { ip: "203.0.113.7" },
    );

    expect(res).toEqual({ status: "otp_sent" }); // ack unchanged (EARS-16)
    expect(idp.smsOtpSendCount()).toBe(0); // zero real send left the box
  });

  it("003 EARS-33: ON + UNtagged real phone → the provider SMS send proceeds", async () => {
    const idp = new FakeIdpClient();
    const service = buildOtpService(enabled(), idp);

    await service.requestLoginOtp(
      { identifier: "+79991234567", channel: "sms" },
      { ip: "203.0.113.7" },
    );

    expect(idp.smsOtpSendCount()).toBe(1);
  });

  it("003 EARS-33: OFF (inert) + reserved test-MSISDN → the provider SMS send proceeds", async () => {
    const idp = new FakeIdpClient();
    const service = buildOtpService(SyntheticSuppression.disabled(), idp);

    await service.requestLoginOtp(
      { identifier: "+9991234567", channel: "sms" },
      { ip: "203.0.113.7" },
    );

    expect(idp.smsOtpSendCount()).toBe(1);
  });
});

// #1112 (auth failure observability): a FAILED verify / reset-complete now appends
// a reason-coded, PD-safe failure row to the audit ledger — the incident driver was
// that a rejected verify/login code was recorded NOWHERE on our side (diagnosis
// needed raw SSH SQL against Zitadel's null-payload `verification.failed`). The
// client-visible outcome is unchanged (same generic 400, same body, EARS-16), and
// the recorded payload NEVER carries the plaintext one-time code (003 EARS-30).
// Reasons collapse to what the boolean IdP port exposes: `no-account` (no mirror
// row) and `invalid` (the port returned false/null — wrong/expired/superseded are
// indistinguishable from a boolean). Exercised at the service altitude over the fake
// IdP + in-memory audit + a mirror stub (no DB, no HTTP).
describe("AuthService — reason-coded auth-failure observability (#1112)", () => {
  function buildFailObsService(
    idp: IdpClient,
    mirror: unknown,
    audit: InMemoryAuthAuditLog,
    sessions: unknown = {} as never,
  ): AuthService {
    return new AuthService(
      idp,
      explodingDb as never, // verify/reset touch no DB directly
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      mirror as never,
      sessions as never,
      {} as never, // smsBudget — unused
    );
  }

  it("#1112: a verify for an UNKNOWN email records one VerifyFailed(invalid) and returns the generic 400", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const service = buildFailObsService(idp as unknown as IdpClient, {}, audit);

    const err = await service
      .verify({ email: "ghost@ds.test", code: FAKE_VALID_CODE }, "fp")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
    expect(audit.events).toEqual([
      { type: "VerifyFailed", identifier: "ghost@ds.test", reason: "invalid" },
    ]);
  });

  it("#1112: a verify with a WRONG code records one VerifyFailed(invalid) — and NEVER the plaintext code (EARS-30)", async () => {
    const idp = new FakeIdpClient();
    await idp.createUser({ email: "u@ds.test", password: "Aa1!long-enough-pw" });
    const audit = new InMemoryAuthAuditLog();
    const service = buildFailObsService(idp as unknown as IdpClient, {}, audit);
    const code = "ZZZZZZ";

    const err = await service
      .verify({ email: "u@ds.test", code }, "fp")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(audit.events).toEqual([
      { type: "VerifyFailed", identifier: "u@ds.test", reason: "invalid" },
    ]);
    // 003 EARS-30: the recorded payload never carries the one-time code.
    expect(JSON.stringify(audit.events)).not.toContain(code);
  });

  it("#1112: a completePasswordReset with a bad/expired code records one PasswordResetFailed(invalid) — never the code (EARS-30) — and returns the generic 400", async () => {
    const idp = new FakeIdpClient();
    await idp.createUser({
      email: "reset@ds.test",
      password: "Aa1!old-sufficiently-long",
    });
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const sessions = new SessionService(idp, store, audit);
    const service = buildFailObsService(
      idp as unknown as IdpClient,
      {} as never, // mirror — unused on the reset path
      audit,
      sessions,
    );
    const code = "BADCODE9";

    const err = await service
      .completePasswordReset(
        "reset@ds.test",
        code,
        "Aa1!new-sufficiently-long",
        "fp",
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
    // Only the failure row — the throw precedes any revoke/mint, so no
    // PasswordResetCompleted / LoginSucceeded row leaks (EARS-16 unchanged).
    expect(audit.events).toEqual([
      { type: "PasswordResetFailed", identifier: "reset@ds.test", reason: "invalid" },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain(code);
  });
});

// #1109 (EARS-3): the registration email-verify code Zitadel emits is UPPERCASE
// alphanumeric, and Zitadel's compare is case-sensitive with no trim. A doctor who
// types the code lowercased — or whose keyboard/paste pads it with whitespace —
// was rejected end-to-end. The BFF now normalizes `code.trim().toUpperCase()`
// before the IdP `verifyEmail` hop, so the same human input succeeds. Uppercasing
// a digit login OTP is a no-op, so this is safe for the shared field. Exercised at
// the service altitude over the fake IdP + a minimal mirror stub (no DB, no HTTP).
describe("AuthService.verify — code normalization (#1109, EARS-3)", () => {
  function buildVerifyService(idp: IdpClient, mirror: unknown): AuthService {
    return new AuthService(
      idp,
      explodingDb as never, // the verify path touches no DB directly
      undefined,
      new InMemoryAuthAuditLog(),
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      mirror as never, // mirror — unused on a failed submission
      {} as never, // sessions — unused
      {} as never, // smsBudget — unused
    );
  }

  it("EARS-3: normalizes a lowercase, whitespace-padded code to trimmed-uppercase before the IdP submission (#1109)", async () => {
    const idp = new FakeIdpClient();
    const spy = vi.spyOn(idp as unknown as IdpClient, "submitEmailCode");
    const service = buildVerifyService(idp as unknown as IdpClient, {});

    // Outcome is a generic 400 (unknown address); we assert the NORMALIZED
    // argument the IdP port receives.
    await service
      .verify({ email: "u@ds.test", code: "  pvdc3r  " }, "fp")
      .catch(() => undefined);

    expect(spy).toHaveBeenCalledWith("u@ds.test", "PVDC3R", undefined);
  });
});

// 003 EARS-34 (#1131): a login-by-email-code request for an existing but
// email-UNVERIFIED account must NOT arm the Zitadel `otp_email` login challenge —
// Zitadel never sends a login code to an unverified email (the historic silent
// dead-end). Instead the BFF re-issues the verify-to-sign-in code and dispatches
// the branded, code-only §13.3 mail out-of-band (the same EARS-25/29 mailer hop),
// fire-and-forget off the response path. The synchronous ack is byte-identical
// across {nonexistent, existing-unverified, existing-verified} (EARS-16); the
// `otp.sent` ledger row is appended only when a code is actually issued (an
// existing account), never for a nonexistent identifier — so neither the response
// nor the ledger is an existence/verification oracle. Exercised at the service
// altitude over the fake IdP + FakeMailer + in-memory audit (no DB, no HTTP).
describe("AuthService.requestLoginOtp — email unverified out-of-band recovery (003 EARS-34, #1131)", () => {
  const password = "Aa1!sufficiently-long-pw";
  const ctx = { ip: "203.0.113.9" };

  function buildEmailOtpService(
    idp: FakeIdpClient,
    mailer: Mailer,
    audit: InMemoryAuthAuditLog,
  ): AuthService {
    return new AuthService(
      idp as unknown as IdpClient,
      explodingDb as never, // the email otp-request path touches no DB
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      {} as never, // mirror — unused on this path
      {} as never, // sessions — unused
      {} as never, // smsBudget — unused on the email path
    );
  }

  it("003 EARS-34: an existing-UNVERIFIED account gets its verification code in the sign-in mail (1-hour lifetime) and arms NO otp_email challenge", async () => {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    const email = "unverified-login@ds.test";
    await idp.createUser({ email, password }); // unverified (never verifyEmail'd)
    const audit = new InMemoryAuthAuditLog();
    const service = buildEmailOtpService(idp, mailer, audit);

    const res = await service.requestLoginOtp(
      { identifier: email, channel: "email" },
      ctx,
    );

    expect(res).toEqual({ status: "otp_sent" });
    // The same sign-in mail as a verified account gets, stating 1 hour.
    expect(mailer.loginCodeEmails).toEqual([
      { to: email, code: FAKE_VALID_CODE, lifetime: "1h" },
    ]);
    expect(mailer.verificationCodeEmails).toEqual([]);
    // No otp_email login challenge was armed: a follow-up verify with the VALID
    // code still yields null (nothing to check against).
    await expect(
      idp.loginWithEmailOtp(email, FAKE_VALID_CODE),
    ).resolves.toBeNull();
    // The otp.sent ledger row stands — a verification code WAS issued.
    expect(audit.events).toEqual([
      { type: "OtpSent", identifier: email, channel: "email" },
    ]);
  });

  it("003 EARS-34: an existing-VERIFIED account arms the otp_email challenge as usual and gets NO verification email", async () => {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    const email = "verified-login@ds.test";
    const created = await idp.createUser({ email, password });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE); // now verified
    const audit = new InMemoryAuthAuditLog();
    const service = buildEmailOtpService(idp, mailer, audit);

    const res = await service.requestLoginOtp(
      { identifier: email, channel: "email" },
      ctx,
    );

    expect(res).toEqual({ status: "otp_sent" });
    // A verified account receives NO verification mail (EARS-6 arm-unchanged).
    expect(mailer.verificationCodeEmails).toEqual([]);
    // The otp_email challenge was armed: the valid code now checks out.
    await expect(
      idp.loginWithEmailOtp(email, FAKE_VALID_CODE),
    ).resolves.not.toBeNull();
    expect(audit.events).toEqual([
      { type: "OtpSent", identifier: email, channel: "email" },
    ]);
  });

  it("003 EARS-34/16: a nonexistent identifier is a silent no-op — no challenge, no mail, no ledger row — with the identical ack", async () => {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    const audit = new InMemoryAuthAuditLog();
    const service = buildEmailOtpService(idp, mailer, audit);

    const res = await service.requestLoginOtp(
      { identifier: "nobody-login@ds.test", channel: "email" },
      ctx,
    );

    // Byte-identical ack to the existing-account paths (no existence oracle).
    expect(res).toEqual({ status: "otp_sent" });
    expect(mailer.verificationCodeEmails).toEqual([]);
    await expect(
      idp.loginWithEmailOtp("nobody-login@ds.test", FAKE_VALID_CODE),
    ).resolves.toBeNull();
    // No code was issued, so no otp.sent row exists: the ledger discloses nothing.
    expect(audit.events).toEqual([]);
  });

  it("003 EARS-34/31: a fire-and-forget verification-send failure never alters the ack (still otp_sent, no throw)", async () => {
    // The out-of-band send is off the response path: a total mailer outage
    // (EARS-31) must never differentiate the response or turn into a 500.
    const exploding: Mailer = {
      sendReRegistrationCodeEmail: () =>
        Promise.reject(new Error("smtp down")),
      sendVerificationCodeEmail: () => Promise.reject(new Error("smtp down")),
      sendPasswordResetCodeEmail: () => Promise.reject(new Error("smtp down")),
      sendAdminLockoutNotice: () => Promise.reject(new Error("smtp down")),
      sendLoginCodeEmail: () => Promise.reject(new Error("smtp down")),
      sendCongressRegistrationConfirmation: () =>
        Promise.reject(new Error("smtp down")),
      sendCongressSubmissionReceipt: () =>
        Promise.reject(new Error("smtp down")),
    };
    const idp = new FakeIdpClient(exploding);
    const email = "unverified-outage@ds.test";
    await idp.createUser({ email, password }); // unverified
    const audit = new InMemoryAuthAuditLog();
    const service = buildEmailOtpService(idp, exploding, audit);

    const res = await service.requestLoginOtp(
      { identifier: email, channel: "email" },
      ctx,
    );

    expect(res).toEqual({ status: "otp_sent" });
    // The verification code WAS issued (Zitadel returnCode); the delivery failure
    // is swallowed off the response path, so the otp.sent row still stands.
    expect(audit.events).toEqual([
      { type: "OtpSent", identifier: email, channel: "email" },
    ]);
  });
});

// 003 EARS-34 (#1131): the FakeIdpClient.requestEmailLoginCode must be NO MORE
// PERMISSIVE than the real Zitadel adapter — it routes an existing-unverified
// account to the out-of-band verification mail ("verification"), a verified one to
// the armed otp_email challenge ("challenge"), and an unknown identifier to a
// silent no-op ("none"), exactly the verified/unverified/absent distinction the
// real adapter draws off the User v2 `human.email.isVerified` search.
describe("FakeIdpClient.requestEmailLoginCode — parity with real adapter (003 EARS-34, #1131)", () => {
  const password = "Aa1!sufficiently-long-pw";

  it("resolves 'verification' and mails the code in the sign-in mail for an existing UNVERIFIED account", async () => {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    await idp.createUser({ email: "u@ds.test", password });
    await expect(idp.requestEmailLoginCode("u@ds.test")).resolves.toBe(
      "verification",
    );
    expect(mailer.loginCodeEmails).toEqual([
      { to: "u@ds.test", code: FAKE_VALID_CODE, lifetime: "1h" },
    ]);
  });

  it("resolves 'challenge' and arms otp_email for an existing VERIFIED account", async () => {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    const created = await idp.createUser({ email: "v@ds.test", password });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    await expect(idp.requestEmailLoginCode("v@ds.test")).resolves.toBe(
      "challenge",
    );
    expect(mailer.verificationCodeEmails).toEqual([]);
    await expect(
      idp.loginWithEmailOtp("v@ds.test", FAKE_VALID_CODE),
    ).resolves.not.toBeNull();
  });

  it("resolves 'none' (no challenge, no mail) for an unknown identifier", async () => {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    await expect(idp.requestEmailLoginCode("nobody@ds.test")).resolves.toBe(
      "none",
    );
    expect(mailer.verificationCodeEmails).toEqual([]);
  });
});

// 003 EARS-35 (#1131): a completed password reset (a valid reset code proven with
// a policy-conforming new password) is itself proof the subject controls the
// mailbox, so the BFF marks the account's email verified at the IdP + mirror and
// appends the terminal `auth.account.verified` (channel email) row — closing the
// stuck-unverified trap through the existing recovery path (EARS-6/EARS-34). No
// state is mutated before a valid token (OWASP): a bad/expired code flips nothing.
// The flip is idempotent (an already-verified account → no-op, no duplicate row).
// Exercised at the service altitude over the fake IdP + real SessionService over
// fakes + a mirror spy (no DB, no HTTP).
describe("AuthService.completePasswordReset — proof-of-mailbox email verify (003 EARS-35, #1131)", () => {
  const email = "stuck-unverified@ds.test";
  const oldPassword = "Aa1!old-sufficiently-long";
  const newPassword = "Aa1!new-sufficiently-long";
  const fingerprint = "fp-reset-device";

  async function buildFlipService(seedVerified: boolean): Promise<{
    service: AuthService;
    idp: FakeIdpClient;
    audit: InMemoryAuthAuditLog;
    mirrorFlips: string[];
    sub: string;
  }> {
    const idp = new FakeIdpClient();
    const created = await idp.createUser({ email, password: oldPassword });
    if (seedVerified) await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const sessions = new SessionService(idp, store, audit);
    const mirrorFlips: string[] = [];
    const mirror = {
      markEmailVerified: (sub: string) => {
        mirrorFlips.push(sub);
        return Promise.resolve();
      },
    };
    const service = new AuthService(
      idp,
      explodingDb as never, // the reset path touches no DB directly
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      mirror as never,
      sessions,
      {} as never, // smsBudget — unused
    );
    return { service, idp, audit, mirrorFlips, sub: created.sub };
  }

  it("003 EARS-35: a completed reset on an UNVERIFIED account flips email_verified at the IdP + mirror and appends one auth.account.verified (channel email) row", async () => {
    const { service, idp, audit, mirrorFlips, sub } =
      await buildFlipService(false);

    await service.requestPasswordReset(email);
    await service.completePasswordReset(
      email,
      FAKE_VALID_CODE,
      newPassword,
      fingerprint,
    );

    await expect(idp.getUser(sub)).resolves.toMatchObject({
      emailVerified: true,
    });
    expect(mirrorFlips).toEqual([sub]);
    expect(audit.events).toContainEqual({
      type: "IdentifierVerified",
      sub,
      channel: "email",
    });
  });

  it("003 EARS-35: idempotent — a completed reset on an ALREADY-VERIFIED account performs no flip and appends NO auth.account.verified row", async () => {
    const { service, audit, mirrorFlips, sub } = await buildFlipService(true);

    await service.requestPasswordReset(email);
    await service.completePasswordReset(
      email,
      FAKE_VALID_CODE,
      newPassword,
      fingerprint,
    );

    // No flip (already verified) and no duplicate verified row.
    expect(mirrorFlips).toEqual([]);
    expect(audit.events).not.toContainEqual({
      type: "IdentifierVerified",
      sub,
      channel: "email",
    });
  });

  it("003 EARS-35/16: a bad/expired reset code mutates nothing — no verify flip, no verified row (still generic 400)", async () => {
    const { service, idp, audit, mirrorFlips, sub } =
      await buildFlipService(false);
    await service.requestPasswordReset(email);

    const err = await service
      .completePasswordReset(email, "000000", newPassword, fingerprint)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    // No state mutated before a valid token (OWASP).
    await expect(idp.getUser(sub)).resolves.toMatchObject({
      emailVerified: false,
    });
    expect(mirrorFlips).toEqual([]);
    expect(audit.events).not.toContainEqual({
      type: "IdentifierVerified",
      sub,
      channel: "email",
    });
  });
});

// 003 EARS-35 (#1131): the FakeIdpClient.markEmailVerified must be NO MORE
// PERMISSIVE than the real Zitadel adapter — it flips an unverified account
// (resolves true), is idempotent for an already-verified one (resolves false, no
// change), and no-ops an unknown sub (resolves false), mirroring the real
// adapter's SetEmail(isVerified) over the resolved sub.
describe("FakeIdpClient.markEmailVerified — parity with real adapter (003 EARS-35, #1131)", () => {
  const password = "Aa1!sufficiently-long-pw";

  it("flips an unverified account and resolves true", async () => {
    const idp = new FakeIdpClient();
    const created = await idp.createUser({ email: "m@ds.test", password });
    await expect(idp.markEmailVerified(created.sub)).resolves.toBe(true);
    await expect(idp.getUser(created.sub)).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it("is idempotent — an already-verified account resolves false with no change", async () => {
    const idp = new FakeIdpClient();
    const created = await idp.createUser({ email: "m2@ds.test", password });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    await expect(idp.markEmailVerified(created.sub)).resolves.toBe(false);
  });

  it("resolves false for an unknown sub", async () => {
    const idp = new FakeIdpClient();
    await expect(idp.markEmailVerified("no-such-sub")).resolves.toBe(false);
  });
});

// 003 EARS-41: one email-code submission. The account state — never the caller
// — picks the Zitadel check; the first accepted code of an unverified account
// flips the address, writes ONE auth.account.verified row, leaves no
// pre-verification password and no prior session behind, and signs the user
// in. Registration values apply only after the code is accepted (EARS-23).
// Service altitude over the fake IdP, the real SessionService over the
// in-memory store, a recording mirror and a consent-table stub.
describe("AuthService — one email-code submission (003 EARS-41/23)", () => {
  const first = "Aa1!first-pass-long";
  const second = "Aa1!second-pass-long";
  const ctx = { ip: "203.0.113.7" };

  function consentDb(held: string[]) {
    const inserted: Array<{ purpose: string; version: string }> = [];
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === users
                ? [{ id: "user-1" }]
                : table === consentRecords
                  ? held.map((purpose) => ({ purpose }))
                  : [],
            ),
        }),
      }),
      insert: () => ({
        values: (rows: Array<{ purpose: string; version: string }>) => {
          inserted.push(...rows);
          return Promise.resolve();
        },
      }),
    };
    return {
      db: { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
      inserted,
    };
  }

  function build(held: string[] = []) {
    const mailer = new FakeMailer();
    const idp = new FakeIdpClient(mailer);
    const audit = new InMemoryAuthAuditLog();
    const store = new InMemorySessionStore();
    const sessions = new SessionService(idp, store, audit);
    const flips: string[] = [];
    const mirror = {
      markEmailVerified: (sub: string) => {
        flips.push(sub);
        return Promise.resolve();
      },
    };
    const { db, inserted } = consentDb(held);
    const service = new AuthService(
      idp as unknown as IdpClient,
      db as never,
      undefined,
      audit,
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      SyntheticSuppression.disabled(),
      mirror as never,
      sessions,
      {} as never,
    );
    return { idp, audit, store, sessions, flips, inserted, service, mailer };
  }

  async function signInByCode(
    service: AuthService,
    email: string,
  ): Promise<{ cookie: string } | null> {
    await service.requestLoginOtp({ identifier: email, channel: "email" }, ctx);
    return service.loginWithOtp(
      { identifier: email, code: FAKE_VALID_CODE, channel: "email" },
      "fp",
    );
  }

  it("003 EARS-41: an unverified account signs in with the code from the sign-in mail — verified, one auth.account.verified row, a session", async () => {
    const { idp, audit, flips, service } = build();
    const created = await idp.createUser({ email: "late@ds.test", password: first });

    const result = await signInByCode(service, "late@ds.test");

    expect(result?.cookie).toContain(SESSION_COOKIE_NAME);
    expect(flips).toEqual([created.sub]);
    expect(
      audit.events.filter((e) => e.type === "IdentifierVerified"),
    ).toEqual([{ type: "IdentifierVerified", sub: created.sub, channel: "email" }]);
    expect((await idp.getUser(created.sub))?.emailVerified).toBe(true);
  });

  it("003 EARS-41: login by code on an unverified account invalidates the pre-verification password", async () => {
    const { idp, service } = build();
    await idp.createUser({ email: "victim@ds.test", password: first });

    await signInByCode(service, "victim@ds.test");

    await expect(idp.passwordLogin("victim@ds.test", first)).resolves.toEqual({
      outcome: "rejected",
    });
  });

  it("003 EARS-41: a credential-less account stays credential-less after its first code (044 EARS-14)", async () => {
    const { idp, service } = build();
    const created = await idp.createUser({
      email: "guest@ds.test",
      credential: "none",
      profile: { givenName: "Г", familyName: "Гость" },
    });

    const result = await signInByCode(service, "guest@ds.test");

    expect(result).not.toBeNull();
    expect(idp.hasCredential(created.sub)).toBe(false);
  });

  it("003 EARS-41: every session the account held before the first accepted code is revoked", async () => {
    const { idp, store, sessions, service } = build();
    await idp.createUser({ email: "squat@ds.test", password: first });
    const squatter = await idp.passwordLogin("squat@ds.test", first);
    if (squatter.outcome !== "authenticated") throw new Error("seed login");
    const before = await sessions.establish(squatter.session, "fp-attacker");
    const sid = parseCookies(before.cookie)[SESSION_COOKIE_NAME] as string;

    await signInByCode(service, "squat@ds.test");

    await expect(store.get(sid)).resolves.toBeUndefined();
  });

  it("003 EARS-41/23: the registration step's password replaces a pre-verification password", async () => {
    const { idp, service } = build();
    await idp.createUser({ email: "again@ds.test", password: first });

    const res = await service.verify(
      {
        email: "again@ds.test",
        code: FAKE_VALID_CODE,
        registration: { password: second, consent: [] },
      },
      "fp",
    );

    expect(res.body).toEqual({ status: "verified" });
    expect(res.cookie).toContain(SESSION_COOKIE_NAME);
    expect((await idp.passwordLogin("again@ds.test", second)).outcome).toBe(
      "authenticated",
    );
    expect((await idp.passwordLogin("again@ds.test", first)).outcome).toBe(
      "rejected",
    );
  });

  it("003 EARS-23: a verified password holder who re-registers keeps the password; the submitted one is ignored", async () => {
    const { idp, flips, service } = build();
    const created = await idp.createUser({ email: "owner@ds.test", password: first });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    await idp.requestEmailLoginCode("owner@ds.test", "re-registration");

    await service.verify(
      {
        email: "owner@ds.test",
        code: FAKE_VALID_CODE,
        registration: { password: second, consent: [] },
      },
      "fp",
    );

    expect(flips).toEqual([]); // already verified: no flip, no verified row
    expect((await idp.passwordLogin("owner@ds.test", first)).outcome).toBe(
      "authenticated",
    );
    expect((await idp.passwordLogin("owner@ds.test", second)).outcome).toBe(
      "rejected",
    );
  });

  it("003 EARS-23: a verified account without a password gets the submitted one after the code", async () => {
    const { idp, service } = build();
    const created = await idp.createUser({
      email: "pwless@ds.test",
      credential: "none",
      profile: { givenName: "Г", familyName: "Гость" },
    });
    await idp.verifyEmail(created.sub, FAKE_VALID_CODE);
    await idp.requestEmailLoginCode("pwless@ds.test", "re-registration");

    await service.verify(
      {
        email: "pwless@ds.test",
        code: FAKE_VALID_CODE,
        registration: { password: second, consent: [] },
      },
      "fp",
    );

    expect((await idp.passwordLogin("pwless@ds.test", second)).outcome).toBe(
      "authenticated",
    );
  });

  it("003 EARS-23: the form consent is recorded after the code only for purposes the account does not hold", async () => {
    const { idp, inserted, service } = build(["congress-personal-data", "tos"]);
    await idp.createUser({
      email: "congress@ds.test",
      credential: "none",
      profile: { givenName: "Г", familyName: "Гость" },
    });

    await service.verify(
      {
        email: "congress@ds.test",
        code: FAKE_VALID_CODE,
        registration: {
          password: second,
          consent: [
            { purpose: "tos", version: "2026-10" },
            { purpose: "medical-worker-declaration", version: "2026-09" },
          ],
        },
      },
      "fp",
    );

    expect(inserted).toEqual([
      { userId: "user-1", purpose: "medical-worker-declaration", version: "2026-09" },
    ]);
  });

  it("003 EARS-23/41: a refused code writes nothing — no password, no consent, no flip", async () => {
    const { idp, inserted, flips, service } = build();
    await idp.createUser({ email: "wrong@ds.test", password: first });

    const err = await service
      .verify(
        {
          email: "wrong@ds.test",
          code: "ZZZZZZ",
          registration: {
            password: second,
            consent: [{ purpose: "tos", version: "2026-10" }],
          },
        },
        "fp",
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(inserted).toEqual([]);
    expect(flips).toEqual([]);
    expect((await idp.passwordLogin("wrong@ds.test", first)).outcome).toBe(
      "authenticated",
    );
  });

  it("003 EARS-41/16: an unknown identifier and a wrong code are the same null on the login path", async () => {
    const { idp, service } = build();
    await idp.createUser({ email: "known@ds.test", password: first });

    const unknown = await service.loginWithOtp(
      { identifier: "nobody@ds.test", code: FAKE_VALID_CODE, channel: "email" },
      "fp",
    );
    const wrong = await service.loginWithOtp(
      { identifier: "known@ds.test", code: "ZZZZZZ", channel: "email" },
      "fp",
    );

    expect(unknown).toBeNull();
    expect(wrong).toBeNull();
  });
});
