import { describe, expect, it } from "vitest";
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
    new FakeMailer(),
    new InMemoryRegisterNoticeThrottle("test-pepper"),
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
      new FakeMailer(),
      new InMemoryRegisterNoticeThrottle("test-pepper"),
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

// EARS-23 (#207): account-exists notice on a duplicate-registration. The
// `alreadyExisted` branch is the EARS-16 hinge — it returns the IDENTICAL
// `pending_verification` and creates nothing — so the legitimate owner's path is
// delivered privately by email (a sign-in / reset notice) instead of leaving them
// stranded on the /verify "enter your code" screen. The send is fire-and-forget,
// per-address throttled, and never alters the response or throws.

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
    opts.mailer,
    opts.throttle,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe("AuthService.register — account-exists notice (#207, EARS-23)", () => {
  const reg: RegisterRequest = {
    email: "owner@ds.test",
    password: "Aa1!sufficiently-long",
    consent,
  };

  it("EARS-23: when a register targets a NEW email, the system shall dispatch NO account-exists notice", async () => {
    const mailer = new FakeMailer();
    const service = buildRegisterService({
      idp: new FakeIdpClient(),
      audit: new InMemoryAuthAuditLog(),
      mailer,
      throttle: new InMemoryRegisterNoticeThrottle("test-pepper"),
    });

    const res = await service.register(reg);
    await flushMicrotasks();

    expect(res).toEqual({ status: "pending_verification" });
    expect(mailer.accountExistsNotices).toEqual([]);
  });

  it("EARS-23: when a register targets an ALREADY-REGISTERED email, the system shall dispatch exactly one account-exists notice", async () => {
    const idp = new FakeIdpClient();
    const mailer = new FakeMailer();
    const service = buildRegisterService({
      idp,
      audit: new InMemoryAuthAuditLog(),
      mailer,
      throttle: new InMemoryRegisterNoticeThrottle("test-pepper"),
    });

    // Pre-register so the second register hits the `alreadyExisted` branch.
    await service.register(reg);
    await flushMicrotasks();
    expect(mailer.accountExistsNotices).toEqual([]); // none on the new branch

    const res = await service.register(reg);
    await flushMicrotasks();

    expect(res).toEqual({ status: "pending_verification" });
    expect(mailer.accountExistsNotices).toEqual(["owner@ds.test"]);
  });

  it("EARS-23: when a duplicate register repeats within the throttle window, the second notice shall be suppressed", async () => {
    const idp = new FakeIdpClient();
    const mailer = new FakeMailer();
    const service = buildRegisterService({
      idp,
      audit: new InMemoryAuthAuditLog(),
      mailer,
      throttle: new InMemoryRegisterNoticeThrottle("test-pepper"),
    });

    await service.register(reg); // new account
    await service.register(reg); // duplicate → notice #1
    await service.register(reg); // duplicate → throttled
    await flushMicrotasks();

    expect(mailer.accountExistsNotices).toEqual(["owner@ds.test"]);
  });

  it("EARS-23: the already-existed branch shall write no account/consent/auth.register ledger row", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const service = buildRegisterService({
      idp,
      audit,
      mailer: new FakeMailer(),
      throttle: new InMemoryRegisterNoticeThrottle("test-pepper"),
    });

    await service.register(reg); // new account → one Registered row
    await service.register(reg); // duplicate → NO new row
    await flushMicrotasks();

    // Exactly the single new-account terminal row; the duplicate added nothing.
    expect(audit.events).toEqual([
      {
        type: "Registered",
        sub: expect.stringMatching(/^fake-sub-/),
        channel: "email",
        consent: [{ purpose: "tos", version: "2026-01" }],
      },
    ]);
  });

  it("EARS-23: when the notice send rejects, the duplicate-register response shall stay identical and not throw", async () => {
    const idp = new FakeIdpClient();
    // A mailer that always rejects — the fire-and-forget rejection must be
    // swallowed, never surfacing on the response path (EARS-16 unchanged).
    const exploding: Mailer = {
      sendAccountExistsNotice: () =>
        Promise.reject(new Error("smtp down")),
      sendVerificationCodeEmail: () =>
        Promise.reject(new Error("smtp down")),
      sendPasswordResetCodeEmail: () =>
        Promise.reject(new Error("smtp down")),
    };
    const service = buildRegisterService({
      idp,
      audit: new InMemoryAuthAuditLog(),
      mailer: exploding,
      throttle: new InMemoryRegisterNoticeThrottle("test-pepper"),
    });

    await service.register(reg); // new account
    const res = await service.register(reg); // duplicate → notice rejects
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
      new FakeMailer(),
      new InMemoryRegisterNoticeThrottle("test-pepper"),
      {} as never, // mirror — unused on the reset path
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
      new FakeMailer(),
      new InMemoryRegisterNoticeThrottle("test-pepper"),
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
