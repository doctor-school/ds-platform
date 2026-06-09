import { describe, expect, it } from "vitest";
import { UnprocessableEntityException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { FakeIdpClient } from "./idp/idp.fake.js";
import { IdpPasswordPolicyError, type IdpClient } from "./idp/idp.types.js";
import type { RegisterRequest } from "@ds/schemas";
import { InMemoryAuthAuditLog } from "./session/auth-audit.fake.js";
import { SmsBudgetService } from "./sms-budget/sms-budget.service.js";
import { DEFAULT_SMS_BUDGET_THRESHOLDS } from "./sms-budget/sms-budget.types.js";

// #147 residual handling (no DB). The creation schema (@ds/schemas NewPassword)
// already rejects baseline-violating passwords at the DTO layer, uniformly and
// before any IdP round-trip. This proves the *residual* race — a live Zitadel
// configured stricter than the baseline 400s inside createUser → the adapter
// raises IdpPasswordPolicyError — maps to a generic, non-enumerating 422, NOT a
// 500, and resolves identically regardless of whether the account exists.

/** Minimal IdpClient: only createUser is exercised; everything else throws if hit. */
function policyRejectingIdp(): IdpClient {
  const base = new FakeIdpClient() as unknown as IdpClient;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "createUser") {
        return () => Promise.reject(new IdpPasswordPolicyError());
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// The DB must never be touched on the policy-rejection path (the throw happens
// before any mirror/consent write); a Proxy that throws on any access proves it.
const explodingDb = new Proxy(
  {},
  {
    get() {
      throw new Error("db must not be touched on a password-policy rejection");
    },
  },
);

function buildService(idp: IdpClient): AuthService {
  return new AuthService(
    idp,
    explodingDb as never,
    undefined,
    { record: () => Promise.resolve() } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const consent = [{ purpose: "tos", version: "2026-01" }];

describe("AuthService.register — residual password-policy rejection (#147)", () => {
  it("maps IdpPasswordPolicyError to a generic 422 (not a 500)", async () => {
    const service = buildService(policyRejectingIdp());
    const req: RegisterRequest = {
      email: "user@ds.test",
      password: "Aa1!aaaa",
      consent,
    };

    const err = await service
      .register(req, { ip: "203.0.113.1" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getStatus()).toBe(422);
  });

  it("rejects identically for email and phone registrants (no existence oracle)", async () => {
    const service = buildService(policyRejectingIdp());

    const emailErr = await service
      .register(
        { email: "a@ds.test", password: "Aa1!aaaa", consent },
        { ip: "203.0.113.1" },
      )
      .catch((e: unknown) => e);
    const phoneErr = await service
      .register(
        { phone: "+19998887777", password: "Aa1!aaaa", consent },
        { ip: "203.0.113.1" },
      )
      .catch((e: unknown) => e);

    expect(emailErr).toBeInstanceOf(UnprocessableEntityException);
    expect(phoneErr).toBeInstanceOf(UnprocessableEntityException);
    expect((emailErr as UnprocessableEntityException).getResponse()).toEqual(
      (phoneErr as UnprocessableEntityException).getResponse(),
    );
  });
});

// EARS-14: the registration phone-verification SMS send (`register` phone
// branch → `idp.requestPhoneVerification`) is gated by the SAME toll-fraud budget
// as the login SMS send (design §10; EARS-14 covers "verification or login OTP").
// But unlike login — which throws a 429 because no account exists yet — the
// register account + mirror + consent rows are ALREADY committed at the send
// point, so a budget refusal MUST be silent: skip the send, do NOT throw, still
// return `pending_verification`, and STILL emit the owed terminal `Registered`
// audit row (one terminal event per command — no extra refusal event; the
// `SmsBudgetService` counters are the toll-fraud accounting authority).

/**
 * Minimal in-memory DB double satisfying the `register` success-path transaction:
 * the mirror upsert (`.returning([{ id }])`) and the consent insert. No real
 * Postgres — the DB-bound assertions live in the e2e suite; here we isolate the
 * EARS-14 send-gate decision.
 */
function stubDb() {
  const insertChain = {
    values: () => insertChain,
    onConflictDoUpdate: () => insertChain,
    returning: () => Promise.resolve([{ id: "stub-user-id" }]),
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  };
  return {
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: () => insertChain }),
  };
}

function buildRegisterService(
  idp: IdpClient,
  audit: InMemoryAuthAuditLog,
  budget: SmsBudgetService,
): AuthService {
  return new AuthService(
    idp,
    stubDb() as never,
    undefined,
    audit,
    {} as never,
    {} as never,
    budget,
  );
}

const phoneConsent = [{ purpose: "tos", version: "2026-01" }];

describe("AuthService.register — EARS-14 phone-verify SMS budget gate", () => {
  it("EARS-14: when the SMS budget is exhausted, the system shall skip the registration phone-verification send, still create the account (pending_verification), and still record the terminal Registered audit row", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    // Breaker already open: the daily SMS budget is exhausted, so tryConsume → false.
    const budget = new SmsBudgetService(
      { ...DEFAULT_SMS_BUDGET_THRESHOLDS, globalPerDay: 0 },
      () => Date.now(),
    );
    const service = buildRegisterService(idp, audit, budget);
    const req: RegisterRequest = {
      phone: "+19998887777",
      password: "Aa1!ufficiently-long-pw",
      consent: phoneConsent,
    };

    const res = await service.register(req, {
      ip: "203.0.113.7",
      asn: "AS65000",
    });

    // Silent refusal: no throw, the account is still created.
    expect(res).toEqual({ status: "pending_verification" });
    // The send was skipped — no SMS reached the provider.
    expect(idp.phoneVerificationSendCount()).toBe(0);
    // EARS-18: the owed terminal Registered row still fires (account was created),
    // and there is exactly ONE terminal event (no extra refusal event).
    expect(audit.events).toEqual([
      {
        type: "Registered",
        sub: expect.stringMatching(/^fake-sub-/),
        channel: "sms",
        consent: [{ purpose: "tos", version: "2026-01" }],
      },
    ]);
  });

  it("EARS-14: when the SMS budget has room, the system shall send the registration phone-verification code as today", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const budget = new SmsBudgetService(DEFAULT_SMS_BUDGET_THRESHOLDS, () =>
      Date.now(),
    );
    const service = buildRegisterService(idp, audit, budget);

    const res = await service.register(
      {
        phone: "+19998887778",
        password: "Aa1!ufficiently-long-pw",
        consent: phoneConsent,
      },
      { ip: "203.0.113.8", asn: "AS65000" },
    );

    expect(res).toEqual({ status: "pending_verification" });
    expect(idp.phoneVerificationSendCount()).toBe(1);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.type).toBe("Registered");
  });

  it("EARS-14: the email registration branch is never gated by the SMS budget (no SMS), even when the budget is exhausted", async () => {
    const idp = new FakeIdpClient();
    const audit = new InMemoryAuthAuditLog();
    const budget = new SmsBudgetService(
      { ...DEFAULT_SMS_BUDGET_THRESHOLDS, globalPerDay: 0 },
      () => Date.now(),
    );
    const service = buildRegisterService(idp, audit, budget);

    const res = await service.register(
      {
        email: "ears14@ds.test",
        password: "Aa1!ufficiently-long-pw",
        consent: phoneConsent,
      },
      { ip: "203.0.113.9", asn: "AS65000" },
    );

    expect(res).toEqual({ status: "pending_verification" });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.type).toBe("Registered");
  });
});
