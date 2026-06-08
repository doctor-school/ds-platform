import { describe, expect, it } from "vitest";
import { UnprocessableEntityException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { FakeIdpClient } from "./idp/idp.fake.js";
import { IdpPasswordPolicyError, type IdpClient } from "./idp/idp.types.js";
import type { RegisterRequest } from "@ds/schemas";

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

    const err = await service.register(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getStatus()).toBe(422);
  });

  it("rejects identically for email and phone registrants (no existence oracle)", async () => {
    const service = buildService(policyRejectingIdp());

    const emailErr = await service
      .register({ email: "a@ds.test", password: "Aa1!aaaa", consent })
      .catch((e: unknown) => e);
    const phoneErr = await service
      .register({ phone: "+19998887777", password: "Aa1!aaaa", consent })
      .catch((e: unknown) => e);

    expect(emailErr).toBeInstanceOf(UnprocessableEntityException);
    expect(phoneErr).toBeInstanceOf(UnprocessableEntityException);
    expect((emailErr as UnprocessableEntityException).getResponse()).toEqual(
      (phoneErr as UnprocessableEntityException).getResponse(),
    );
  });
});
