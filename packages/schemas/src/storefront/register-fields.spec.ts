import { describe, expect, it } from "vitest";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth/index.js";
import {
  DOCTOR_REGISTER_FIELD_SPECS,
  PROMO_CODE_MAX_LENGTH,
  VERIFY_CODE_LENGTH,
  type FieldSpec,
} from "./register-fields.js";

/**
 * 021 EARS-11 — the per-field validation contract.
 *
 * What is pinned here is the SSOT itself: every field the registration screen
 * renders declares its rule, its mask and its hint in ONE place (021
 * requirements L201 `FieldSpec { name, rule, mask, hint, errorSlot }`, design
 * §7), so the screen composes its react-hook-form rules out of this table
 * instead of re-typing a bound per call site. The RENDERED behaviour is proven
 * in `apps/doctor/e2e/register-validation.spec.ts`; the RHF projection in
 * `apps/doctor/lib/register-fields.test.ts`.
 */
const accepts = (spec: FieldSpec, value: string): boolean =>
  spec.rule.safeParse(value).success;

describe("021 EARS-11: the per-field validation contract", () => {
  it("021 EARS-11.1: email carries an address-shape rule and no mask", () => {
    const spec = DOCTOR_REGISTER_FIELD_SPECS.email;

    expect(spec.name).toBe("email");
    expect(accepts(spec, "doctor@clinic.ru")).toBe(true);
    expect(accepts(spec, "doctor-at-clinic")).toBe(false);
    expect(spec.mask).toBe("none");
    expect(spec.hint).toBeNull();
  });

  it("021 EARS-11.2: password carries the length-only rule and a persistent hint", () => {
    const spec = DOCTOR_REGISTER_FIELD_SPECS.password;

    expect(spec.name).toBe("password");
    expect(accepts(spec, "a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(accepts(spec, "a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(accepts(spec, "a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
    // 003 EARS-36 — length only: no character-class requirement of any kind.
    expect(accepts(spec, "12345678")).toBe(true);
    expect(spec.mask).toBe("none");
    expect(spec.hint).not.toBeNull();
  });

  it("021 EARS-11.3: promoCode trims and is bounded, with no mask", () => {
    const spec = DOCTOR_REGISTER_FIELD_SPECS.promoCode;

    expect(spec.name).toBe("promoCode");
    expect(accepts(spec, "a".repeat(PROMO_CODE_MAX_LENGTH + 1))).toBe(false);
    expect(accepts(spec, "a".repeat(PROMO_CODE_MAX_LENGTH))).toBe(true);
    expect(spec.rule.parse("  DS-2026  ")).toBe("DS-2026");
    // Optional field: an empty box is a valid absent promo code.
    expect(accepts(spec, "")).toBe(true);
    expect(spec.mask).toBe("none");
    expect(spec.hint).toBeNull();
  });

  it("021 EARS-11.4: code is a fixed-length alphanumeric rule that accepts lowercase", () => {
    const spec = DOCTOR_REGISTER_FIELD_SPECS.code;

    expect(spec.name).toBe("code");
    expect(VERIFY_CODE_LENGTH).toBe(6);
    expect(accepts(spec, "ABC123")).toBe(true);
    // LD-9 / LD-1 — the engine uppercases server-side, so the CLIENT guard is
    // case-insensitive: a lowercase-typed code is a valid code.
    expect(accepts(spec, "abc123")).toBe(true);
    expect(accepts(spec, "  abc123  ")).toBe(true);
    expect(accepts(spec, "abc12")).toBe(false);
    expect(accepts(spec, "abc1234")).toBe(false);
    expect(accepts(spec, "abc-12")).toBe(false);
    expect(spec.mask).toBe("none");
    expect(spec.hint).toBeNull();
  });

  it("021 EARS-11.5: every field routes its error to its own slot and declares no mask", () => {
    const specs = Object.values(DOCTOR_REGISTER_FIELD_SPECS);

    expect(specs).toHaveLength(4);
    for (const spec of specs) {
      expect(spec.mask).toBe("none");
      expect(spec.errorSlot).toBe("field");
    }
  });
});
