import { describe, expect, it } from "vitest";
import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { FakeIdpClient } from "./idp/idp.fake.js";
import {
  IdpInvalidArgumentError,
  IdpPasswordPolicyError,
  IdpUnavailableError,
  type IdpClient,
} from "./idp/idp.types.js";
import type { RegisterRequest } from "@ds/schemas";
import { InMemoryAuthAuditLog } from "./session/auth-audit.fake.js";
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
