import { describe, expect, it } from "vitest";

import {
  DOCTOR_REGISTER_FIELD_SPECS,
  PROMO_CODE_MAX_LENGTH,
} from "@ds/schemas";

import {
  identifierFieldSchema,
  loginIdentifierFormSchema,
  otpIdentifierFormSchema,
  registerFieldRules,
  resolveVerificationCode,
} from "./index";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";

/**
 * 021 EARS-11 (#1547) — the react-hook-form projection of the FieldSpec SSOT,
 * now config-switched (#2027, rows 9 and 21).
 *
 * The contract under test is the DERIVATION: no screen holds a bound of its own,
 * so every rejection here traces back to `DOCTOR_REGISTER_FIELD_SPECS`, and only
 * the Russian wording is the host's.
 */
const COPY = DOCTOR_FIXTURE.copy.fields;

describe("021 EARS-11: the registration form rules derive from the FieldSpec SSOT", () => {
  it("021 EARS-11.1: the email rule rejects a malformed address with the screen's copy", () => {
    const rules = registerFieldRules(DOCTOR_FIXTURE, "email");

    expect(rules.required).toBe(COPY.email.required);
    expect(rules.validate("doctor-at-clinic")).toBe(COPY.email.invalid);
    expect(rules.validate("doctor@clinic.ru")).toBe(true);
  });

  it("021 EARS-11.2: the password rule restates the single length rule in its error", () => {
    const rules = registerFieldRules(DOCTOR_FIXTURE, "password");
    const hint = DOCTOR_REGISTER_FIELD_SPECS.password.hint;

    expect(rules.validate("short12")).toBe(COPY.password.invalid);
    expect(rules.validate("longenough")).toBe(true);
    // 003 EARS-37 (owner decision Б) — one slot: the error restates the rule
    // the hint states, because the error REPLACES the hint when it appears.
    expect(hint).not.toBeNull();
    expect(COPY.password.invalid).toContain("8");
    expect(hint).toContain("8");
  });

  it("021 EARS-11.3: the promo rule is optional, trimmed and bounded", () => {
    const rules = registerFieldRules(DOCTOR_FIXTURE, "promoCode");

    expect(rules.required).toBeUndefined();
    expect(rules.validate("")).toBe(true);
    expect(rules.validate(undefined)).toBe(true);
    expect(rules.validate("  DS-2026  ")).toBe(true);
    expect(rules.validate("a".repeat(PROMO_CODE_MAX_LENGTH))).toBe(true);
    expect(rules.validate("a".repeat(PROMO_CODE_MAX_LENGTH + 1))).toBe(
      COPY.promoCode?.invalid,
    );
  });

  it("021 EARS-11.4: the confirmation code accepts a lowercase alphanumeric code", () => {
    expect(resolveVerificationCode(DOCTOR_FIXTURE, "abc123")).toBeNull();
    expect(resolveVerificationCode(DOCTOR_FIXTURE, "ABC123")).toBeNull();
    for (const bad of ["abc12", "abc-12", undefined]) {
      expect(resolveVerificationCode(DOCTOR_FIXTURE, bad)).toBe(COPY.code.invalid);
    }
  });

  it("003 EARS-7: a host that serves no SMS refuses the phone shape in its identifier box", () => {
    // The union box is the SMS host's, not the package's default: promising an
    // E.164 sign-in on a host with no SMS channel buys a round trip that can
    // only fail, and the doctor would read the generic outcome copy for it.
    expect(identifierFieldSchema(ACADEMY_FIXTURE).safeParse("+79991234567").success).toBe(true);
    expect(identifierFieldSchema(DOCTOR_FIXTURE).safeParse("+79991234567").success).toBe(false);
    expect(identifierFieldSchema(DOCTOR_FIXTURE).safeParse("doctor@clinic.ru").success).toBe(true);
    expect(
      loginIdentifierFormSchema(DOCTOR_FIXTURE).safeParse({
        identifier: "+79991234567",
        password: "Sup3r$ecretPw!9",
      }).success,
    ).toBe(false);
  });

  it("003 EARS-7: the OTP request shape is refused for a channel the host does not serve", () => {
    // Row 21 switches the validator by `config.channels`, and the OTP shape is
    // part of it: an email-only storefront must not be able to build the SMS
    // request at all. Without the config the caller could hand the package a
    // channel its own host never offers and buy a round trip that can only fail.
    expect(
      otpIdentifierFormSchema(ACADEMY_FIXTURE, "sms").safeParse({
        identifier: "+79991234567",
        channel: "sms",
      }).success,
    ).toBe(true);
    expect(
      otpIdentifierFormSchema(DOCTOR_FIXTURE, "sms").safeParse({
        identifier: "+79991234567",
        channel: "sms",
      }).success,
    ).toBe(false);
    expect(
      otpIdentifierFormSchema(DOCTOR_FIXTURE, "email").safeParse({
        identifier: "doctor@clinic.ru",
        channel: "email",
      }).success,
    ).toBe(true);
  });
});
