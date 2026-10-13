import { describe, expect, it } from "vitest";
import { resolveAuthFlowCopy } from "../copy";

import { PASSWORD_MIN_LENGTH, PROMO_CODE_MAX_LENGTH } from "@ds/schemas";

import {
  identifierFieldSchema,
  loginIdentifierFormSchema,
  otpIdentifierFormSchema,
  registerFieldHint,
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
const COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).fields;

describe("021 EARS-11: the registration form rules derive from the FieldSpec SSOT", () => {
  it("021 EARS-11.1: the email rule rejects a malformed address with the screen's copy", () => {
    const rules = registerFieldRules(DOCTOR_FIXTURE, "email");

    expect(rules.required).toBe(COPY.email.required);
    expect(rules.validate("doctor-at-clinic")).toBe(COPY.email.invalid);
    expect(rules.validate("doctor@clinic.ru")).toBe(true);
  });

  it("021 EARS-11.2: the password rule rejects a too-short password with the catalog error", () => {
    const rules = registerFieldRules(DOCTOR_FIXTURE, "password");

    expect(rules.validate("short12")).toBe(COPY.password.invalid);
    expect(rules.validate("longenough")).toBe(true);
  });

  it.each([
    ["Academy", ACADEMY_FIXTURE],
    ["doctor", DOCTOR_FIXTURE],
  ] as const)(
    "003 EARS-37: on the %s host the password error is the catalog copy of the ONE rule the hint states",
    (_host, fixture) => {
      // Owner decision Б — one slot: the error REPLACES the hint when it
      // appears, so it must name exactly the rule the hint named, no more and
      // no less, or the swap costs the visitor the rule they still need.
      const hint = registerFieldHint("password");
      const catalogError = resolveAuthFlowCopy(fixture).fields.password.invalid;
      const rules = registerFieldRules(fixture, "password");

      expect(hint).toBe(`Не менее ${PASSWORD_MIN_LENGTH} символов.`);
      // The rejection the field shows IS the message-catalog entry (EARS-21).
      expect(rules.validate("short12")).toBe(catalogError);
      expect(catalogError).toBe(hint);
      // Length-only policy (EARS-36): no character class is ever asked for.
      for (const text of [hint, catalogError]) {
        expect(text).not.toMatch(/заглавн|строчн|цифр|спецсимвол/i);
      }
    },
  );

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

  it("021 EARS-11.4: the confirmation code is exactly six digits (#2636)", () => {
    expect(resolveVerificationCode(DOCTOR_FIXTURE, "482913")).toBeNull();
    expect(resolveVerificationCode(DOCTOR_FIXTURE, " 482913 ")).toBeNull();
    for (const bad of ["abc123", "ABC123", "48291", "4829134", "482-91", undefined]) {
      expect(resolveVerificationCode(DOCTOR_FIXTURE, bad)).toBe(
        COPY.code.invalid,
      );
    }
  });

  it("003 EARS-7 (#2443): the identifier box is the email-or-E.164 union on every storefront", () => {
    // The channels are a package constant (e-mail and SMS), so no host can
    // narrow the box: the phone shape and the address shape are both accepted.
    expect(identifierFieldSchema().safeParse("+79991234567").success).toBe(
      true,
    );
    expect(identifierFieldSchema().safeParse("doctor@clinic.ru").success).toBe(
      true,
    );
    expect(identifierFieldSchema().safeParse("99545545445").success).toBe(
      false,
    );
    expect(
      loginIdentifierFormSchema().safeParse({
        identifier: "+79991234567",
        password: "Sup3r$ecretPw!9",
      }).success,
    ).toBe(true);
  });

  it("003 EARS-6/7: the OTP request shape follows the active channel, and only a served channel is built", () => {
    expect(
      otpIdentifierFormSchema("sms").safeParse({
        identifier: "+79991234567",
        channel: "sms",
      }).success,
    ).toBe(true);
    expect(
      otpIdentifierFormSchema("sms").safeParse({
        identifier: "doctor@clinic.ru",
        channel: "sms",
      }).success,
    ).toBe(false);
    expect(
      otpIdentifierFormSchema("email").safeParse({
        identifier: "doctor@clinic.ru",
        channel: "email",
      }).success,
    ).toBe(true);
    expect(
      otpIdentifierFormSchema("email").safeParse({
        identifier: "doctor@clinic.ru",
        channel: "telegram",
      }).success,
    ).toBe(false);
  });
});
