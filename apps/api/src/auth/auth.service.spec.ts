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
