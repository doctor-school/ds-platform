import { describe, expect, it } from "vitest";
import {
  LoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordResetCompleteRequestSchema,
  RegisterRequestSchema,
  VerifyRequestSchema,
} from "./auth.schema.js";

// 003 EARS-36 — the creation-password policy is LENGTH ONLY (min 8, no character
// classes), mirrored here from the single `PASSWORD_MIN_LENGTH` SSOT constant that
// the provisioned Zitadel instance policy (`minLength = 8`, every class flag
// `false`) is the authority for. The login schema stays a permissive shape guard
// (min 8, NO composition rule) so a credential created under the previous
// four-class policy is never invalidated at the DTO layer — nothing is rotated or
// re-validated (#1331, supersedes the #147 four-class baseline).

const consent = [{ purpose: "tos", version: "2026-01" }];

// Policy-conforming under the length-only rule: 8 chars, ZERO character classes
// beyond lower-case letters (no upper-case, no digit, no symbol).
const COMPLIANT = "пароль12";

describe("003 EARS-36: creation password policy (length-only, mirrors the provisioned IdP policy)", () => {
  // Every one of these was REJECTED by the superseded four-class baseline and
  // must now be ACCEPTED: length is the only rule.
  const classFree: Array<[label: string, password: string]> = [
    ["no uppercase", "aa1!aaaa"],
    ["no lowercase", "AA1!AAAA"],
    ["no digit", "Aa!aaaaa"],
    ["no symbol", "Aa1aaaaa"],
    ["no class at all — 8 plain lower-case letters", "aaaaaaaa"],
  ];

  it("003 EARS-36: the SSOT constants are the length-only policy (8 ≤ len ≤ 256)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(256);
  });

  describe("RegisterRequestSchema.password", () => {
    it("003 EARS-36: accepts an 8-character password with no character classes", () => {
      expect(
        RegisterRequestSchema.safeParse({
          email: "user@ds.test",
          password: COMPLIANT,
          consent,
        }).success,
      ).toBe(true);
    });

    it.each(classFree)(
      "003 EARS-36: accepts a password with %s",
      (_label, password) => {
        expect(
          RegisterRequestSchema.safeParse({
            email: "user@ds.test",
            password,
            consent,
          }).success,
        ).toBe(true);
      },
    );

    it("003 EARS-36: rejects a 7-character password (below the length floor)", () => {
      expect(
        RegisterRequestSchema.safeParse({
          email: "user@ds.test",
          password: "a".repeat(PASSWORD_MIN_LENGTH - 1),
          consent,
        }).success,
      ).toBe(false);
    });

    it("003 EARS-36: rejects a >256 char password (upper bound preserved)", () => {
      expect(
        RegisterRequestSchema.safeParse({
          email: "user@ds.test",
          password: "a".repeat(PASSWORD_MAX_LENGTH + 1),
          consent,
        }).success,
      ).toBe(false);
    });
  });

  describe("PasswordResetCompleteRequestSchema.newPassword", () => {
    it("003 EARS-36: accepts an 8-character new password with no character classes", () => {
      expect(
        PasswordResetCompleteRequestSchema.safeParse({
          identifier: "user@ds.test",
          code: "424242",
          newPassword: COMPLIANT,
        }).success,
      ).toBe(true);
    });

    it.each(classFree)(
      "003 EARS-36: accepts a new password with %s",
      (_label, newPassword) => {
        expect(
          PasswordResetCompleteRequestSchema.safeParse({
            identifier: "user@ds.test",
            code: "424242",
            newPassword,
          }).success,
        ).toBe(true);
      },
    );

    it("003 EARS-36: rejects a 7-character new password", () => {
      expect(
        PasswordResetCompleteRequestSchema.safeParse({
          identifier: "user@ds.test",
          code: "424242",
          newPassword: "a".repeat(PASSWORD_MIN_LENGTH - 1),
        }).success,
      ).toBe(false);
    });
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

  it("003 EARS-36: still accepts a legacy four-class credential (nothing rotated or re-validated)", () => {
    // The length-only creation policy governs CREATION only. A credential created
    // under the superseded upper+lower+digit+symbol baseline must keep passing the
    // login DTO untouched — no existing password is invalidated (#1331).
    expect(
      LoginRequestSchema.safeParse({
        identifier: "user@ds.test",
        password: "Aa1!aaaa",
      }).success,
    ).toBe(true);
  });
});
