import { describe, expect, it } from "vitest";

import { E164 } from "../auth/auth.schema.js";
import { formatContactPhone, normaliseContactPhone } from "./contact-phone.js";

/**
 * 044 EARS-29 — the contact-phone normaliser (044 design §«Contact-phone
 * normalisation and the possible-duplicate derivation»).
 *
 * The normalised value exists for ONE purpose: comparing two submissions of the
 * same event. So what is pinned here is convergence — the shapes a participant
 * actually types have to land on one string — and that the rule is the same one
 * the client-side mask already applies (`maskPhoneInput`,
 * `packages/design-system/src/primitives/fields/phone-mask.ts`), so a phone that
 * passes the form is a phone the server normalises identically.
 *
 * The stored-beside-the-typed-value half is pinned in
 * `congress-signup.schema.spec.ts`; the end-to-end write on a registration row
 * is V-17, an `apps/api` e2e row landing with the intake endpoint.
 */
describe("044 EARS-29: contact-phone normalisation", () => {
  it("044 EARS-29.1: the three typed forms of one number converge on a single value", () => {
    const normalised = [
      "+7 (999) 123-45-67",
      "8 999 1234567",
      "+79991234567",
    ].map(normaliseContactPhone);

    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe("+79991234567");
  });

  it("044 EARS-29.2: the normalised value is E.164-shaped", () => {
    expect(E164.test(normaliseContactPhone("+7 (999) 123-45-67"))).toBe(true);
  });

  it("044 EARS-29.3: a domestic leading 8 is rewritten only at domestic length", () => {
    // 11 digits — the RU domestic form.
    expect(normaliseContactPhone("89991234567")).toBe("+79991234567");
    // 12 digits — an international number that merely starts with 8 keeps it.
    expect(normaliseContactPhone("+81 90 1234 5678")).toBe("+819012345678");
  });

  it("044 EARS-29.4: spaces, brackets, dashes and a leading country-code plus are stripped", () => {
    expect(normaliseContactPhone("  +7 (812) 555-00-11  ")).toBe(
      "+78125550011",
    );
  });

  it("044 EARS-29.5: a value carrying no digits normalises to the empty string, never a bare plus", () => {
    // A bare `+` would pass a naive `startsWith("+")` reader while being no
    // phone at all; the schema refusal below depends on this staying empty.
    expect(normaliseContactPhone("+")).toBe("");
    expect(normaliseContactPhone("   ")).toBe("");
  });

  it("044 EARS-29.6: digits beyond the E.164 maximum of 15 are not carried", () => {
    expect(normaliseContactPhone("+7999123456789012345").length).toBe(16);
  });

  it("044 EARS-29.7: normalisation is idempotent", () => {
    const once = normaliseContactPhone("8 (999) 123-45-67");
    expect(normaliseContactPhone(once)).toBe(once);
  });
});

/**
 * 044 EARS-36 — the one display format of a congress contact phone in the
 * admin (roster, participant card, 046 submission card). Built from the
 * normalised value so the same number written two ways reads identically.
 */
describe("formatContactPhone", () => {
  it("044 EARS-36: every typed shape of one Russian number renders as +7 (XXX) XXX-XX-XX", () => {
    for (const typed of [
      "8 926 310 45 02",
      "+7 (926) 310-45-02",
      "79263104502",
      "+7 926 3104502",
      "+79263104502",
    ]) {
      expect(formatContactPhone(typed)).toBe("+7 (926) 310-45-02");
    }
  });

  it("044 EARS-36: a non-Russian number renders as its plain normalised E.164", () => {
    expect(formatContactPhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("044 EARS-36: a 12-digit international number starting with 8 stays plain international", () => {
    expect(formatContactPhone("+81 90 1234 5678")).toBe("+819012345678");
  });

  it("044 EARS-36: a value carrying no digits renders as the empty string", () => {
    expect(formatContactPhone("")).toBe("");
    expect(formatContactPhone("+")).toBe("");
  });

  it("044 EARS-36: formatting is idempotent", () => {
    const once = formatContactPhone("8 (999) 555-11-22");
    expect(formatContactPhone(once)).toBe(once);
  });
});
