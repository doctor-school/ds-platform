import { describe, expect, it } from "vitest";
import {
  LoginRequestSchema,
  PasswordResetCompleteRequestSchema,
  RegisterRequestSchema,
  VerifyRequestSchema,
} from "./auth.schema.js";

// #147 — password-policy SSOT. The creation schemas (register / reset-complete)
// MUST mirror the live Zitadel default complexity policy (min 8 + upper + lower
// + digit + symbol) so the BFF contract is honest and the portal can pre-validate
// (#131). The login schema MUST stay a permissive shape guard (min 8, NO
// complexity) so a legacy user whose stored password predates the policy is never
// locked out at the DTO layer — Zitadel authenticates whatever it stored.

const consent = [{ purpose: "tos", version: "2026-01" }];

// Baseline-compliant: ≥8, has upper, lower, digit, symbol.
const COMPLIANT = "Aa1!aaaa";

describe("creation password complexity (#147, mirrors Zitadel default policy)", () => {
  // Each entry violates exactly one baseline rule; all must be REJECTED.
  const violations: Array<[label: string, password: string]> = [
    ["no uppercase", "aa1!aaaa"],
    ["no lowercase", "AA1!AAAA"],
    ["no digit", "Aa!aaaaa"],
    ["no symbol", "Aa1aaaaa"],
    ["too short (<8)", "Aa1!aaa"],
  ];

  describe("RegisterRequestSchema.password", () => {
    it("accepts a baseline-compliant password", () => {
      expect(
        RegisterRequestSchema.safeParse({
          email: "user@ds.test",
          password: COMPLIANT,
          consent,
        }).success,
      ).toBe(true);
    });

    it.each(violations)("rejects a password with %s", (_label, password) => {
      expect(
        RegisterRequestSchema.safeParse({
          email: "user@ds.test",
          password,
          consent,
        }).success,
      ).toBe(false);
    });

    it("rejects a >256 char password (upper bound preserved)", () => {
      expect(
        RegisterRequestSchema.safeParse({
          email: "user@ds.test",
          password: `Aa1!${"a".repeat(300)}`,
          consent,
        }).success,
      ).toBe(false);
    });
  });

  describe("PasswordResetCompleteRequestSchema.newPassword", () => {
    it("accepts a baseline-compliant new password", () => {
      expect(
        PasswordResetCompleteRequestSchema.safeParse({
          identifier: "user@ds.test",
          code: "424242",
          newPassword: COMPLIANT,
        }).success,
      ).toBe(true);
    });

    it.each(violations)(
      "rejects a new password with %s",
      (_label, newPassword) => {
        expect(
          PasswordResetCompleteRequestSchema.safeParse({
            identifier: "user@ds.test",
            code: "424242",
            newPassword,
          }).success,
        ).toBe(false);
      },
    );
  });
});

// #202 — email-primary registration. Email is the only registration identifier
// (Zitadel cannot create a login-capable human without an email); the
// dual-identifier "register with email OR phone" model + its `phone` field and
// exactly-one `.refine` were removed. Verify is likewise email-only. Phone stays
// a first-class LOGIN identifier (LoginRequestSchema is untouched).
describe("email-primary registration shape (#202)", () => {
  it("RegisterRequestSchema requires an email", () => {
    expect(
      RegisterRequestSchema.safeParse({ password: COMPLIANT, consent }).success,
    ).toBe(false);
  });

  it("RegisterRequestSchema rejects an invalid email", () => {
    expect(
      RegisterRequestSchema.safeParse({
        email: "not-an-email",
        password: COMPLIANT,
        consent,
      }).success,
    ).toBe(false);
  });

  it("RegisterRequestSchema no longer accepts a phone-only registration", () => {
    expect(
      RegisterRequestSchema.safeParse({
        phone: "+79991234567",
        password: COMPLIANT,
        consent,
      }).success,
    ).toBe(false);
  });

  it("RegisterRequestSchema strips an extra phone field (email-only contract)", () => {
    const parsed = RegisterRequestSchema.safeParse({
      email: "user@ds.test",
      phone: "+79991234567",
      password: COMPLIANT,
      consent,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("phone" in parsed.data).toBe(false);
    }
  });

  it("VerifyRequestSchema is email-only (no phone branch)", () => {
    expect(
      VerifyRequestSchema.safeParse({ email: "user@ds.test", code: "424242" })
        .success,
    ).toBe(true);
    expect(
      VerifyRequestSchema.safeParse({ phone: "+79991234567", code: "424242" })
        .success,
    ).toBe(false);
    expect(VerifyRequestSchema.safeParse({ code: "424242" }).success).toBe(
      false,
    );
  });
});

describe("login password guard (#147, permissive — lockout regression guard)", () => {
  it("accepts a complexity-free password that is ≥8 chars", () => {
    // A legacy credential predating the policy: no upper/digit/symbol. The login
    // DTO MUST accept it and let Zitadel authenticate — applying complexity here
    // would lock the user out of their own (valid) account.
    expect(
      LoginRequestSchema.safeParse({
        identifier: "user@ds.test",
        password: "sufficiently-long-pw",
      }).success,
    ).toBe(true);
  });

  it("still rejects a too-short (<8) password (minimal shape guard kept)", () => {
    expect(
      LoginRequestSchema.safeParse({
        identifier: "user@ds.test",
        password: "short",
      }).success,
    ).toBe(false);
  });
});
