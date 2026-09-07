import { describe, expect, it } from "vitest";

import {
  DOCTOR_REGISTER_FIELD_SPECS,
  PROMO_CODE_MAX_LENGTH,
} from "@ds/schemas";

import {
  REGISTER_FIELD_MESSAGES,
  registerFieldRules,
  resolveVerificationCode,
} from "./register-fields";

/**
 * 021 EARS-11 (#1547) — the react-hook-form projection of the FieldSpec SSOT.
 *
 * The contract under test is the DERIVATION: the screen holds no bound of its
 * own, so every rejection here traces back to
 * `DOCTOR_REGISTER_FIELD_SPECS`, and only the Russian wording is the host's.
 */
describe("021 EARS-11: the registration form rules derive from the FieldSpec SSOT", () => {
  it("021 EARS-11.1: the email rule rejects a malformed address with the screen's copy", () => {
    const rules = registerFieldRules("email");

    expect(rules.required).toBe(REGISTER_FIELD_MESSAGES.email.required);
    expect(rules.validate("doctor-at-clinic")).toBe(
      REGISTER_FIELD_MESSAGES.email.invalid,
    );
    expect(rules.validate("doctor@clinic.ru")).toBe(true);
  });

  it("021 EARS-11.2: the password rule restates the single length rule in its error", () => {
    const rules = registerFieldRules("password");
    const hint = DOCTOR_REGISTER_FIELD_SPECS.password.hint;

    expect(rules.validate("short12")).toBe(
      REGISTER_FIELD_MESSAGES.password.invalid,
    );
    expect(rules.validate("longenough")).toBe(true);
    // 003 EARS-37 (owner decision Б) — one slot: the error restates the rule
    // the hint states, because the error REPLACES the hint when it appears.
    expect(hint).not.toBeNull();
    expect(REGISTER_FIELD_MESSAGES.password.invalid).toContain("8");
    expect(hint).toContain("8");
  });

  it("021 EARS-11.3: the promo rule is optional, trimmed and bounded", () => {
    const rules = registerFieldRules("promoCode");

    expect(rules.required).toBeUndefined();
    expect(rules.validate("")).toBe(true);
    expect(rules.validate(undefined)).toBe(true);
    expect(rules.validate("  DS-2026  ")).toBe(true);
    expect(rules.validate("a".repeat(PROMO_CODE_MAX_LENGTH))).toBe(true);
    expect(rules.validate("a".repeat(PROMO_CODE_MAX_LENGTH + 1))).toBe(
      REGISTER_FIELD_MESSAGES.promoCode.invalid,
    );
  });

  it("021 EARS-11.4: the confirmation code accepts a lowercase alphanumeric code", () => {
    expect(resolveVerificationCode("abc123")).toBeNull();
    expect(resolveVerificationCode("ABC123")).toBeNull();
    expect(resolveVerificationCode("abc12")).toBe(
      REGISTER_FIELD_MESSAGES.code.invalid,
    );
    expect(resolveVerificationCode("abc-12")).toBe(
      REGISTER_FIELD_MESSAGES.code.invalid,
    );
    expect(resolveVerificationCode(undefined)).toBe(
      REGISTER_FIELD_MESSAGES.code.invalid,
    );
  });
});
