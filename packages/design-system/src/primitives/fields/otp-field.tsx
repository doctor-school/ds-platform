"use client";

import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { FormControl, FormItem, FormLabel, FormMessage } from "../form";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../input-otp";

/**
 * `<OtpField>` (#197) — the semantic one-time-code primitive: the design-system
 * `InputOTP` with `length` slots. Bakes in: fixed length (`length` prop),
 * `autoComplete="one-time-code"`, `maxLength`, the mobile keyboard of its
 * `charset`, and auto-submit-on-completion (#175) — the call site cannot forget
 * any of them.
 *
 * WHY length is a prop, not a constant: every mailed or texted code is six
 * upper-case letters and digits (003 EARS-29 amended — the one code step,
 * `CODE_STEP_LENGTH`), but the admin TOTP challenge is a digit code of its own.
 * Each is fixed, so each auto-submits the moment the last character lands.
 *
 * Char set per surface: every code Zitadel mails or texts is ALPHANUMERIC (e.g.
 * `PVDC3R`), so the widget must accept letters — it does, because we pass NO
 * `pattern` to `InputOTP` (input-otp only restricts input when a `pattern` is
 * given).
 *
 * #212 fix — the field must spread the FULL RHF `field` (name + ref + onBlur),
 * not just `value`/`onChange`. input-otp's controlled hidden input needs a real
 * `ref` (the design-system `InputOTP` forwards it straight to that input) for RHF
 * to bind the field; wiring only `value`+`onChange` left it half-bound and it
 * dropped every keystroke on `/reset` + `/verify`. `onChange` is set explicitly
 * AFTER the spread because input-otp calls `onChange(value: string)` with a raw
 * string (not a DOM event) — RHF's `field.onChange` ingests that string directly.
 *
 * Auto-submit + in-flight guard: the field calls `onComplete()` on completion; the
 * caller's `onComplete` is responsible for the `isSubmitting` guard (it already
 * holds the RHF form), so a double network call cannot fire if completion races a
 * manual click / Enter — identical to the pre-#197 inline logic.
 */
export function OtpField<T extends FieldValues>({
  field,
  length,
  label,
  charset,
  onComplete,
}: {
  field: ControllerRenderProps<T>;
  /** Fixed code length — 6 for every mailed/texted code, the TOTP length for admin MFA. */
  length: number;
  /** Label; required (the surfaces use distinct copy). */
  label: string;
  /**
   * Character set of the code — drives the MOBILE KEYBOARD the field requests
   * (#1110). REQUIRED so no surface can silently inherit the wrong keypad:
   *   • `"alphanumeric"` (every mailed/texted code, e.g. `PVDC3R`) → `inputMode="text"`
   *     + `autoCapitalize="characters"` — a phone shows the FULL keyboard so the
   *     letters are reachable, with uppercase key hints matching the UPPERCASE code.
   *   • `"numeric"` (the admin TOTP, digits) → `inputMode="numeric"` — the digits-only keypad.
   * WHY required, not defaulted: input-otp's `OTPInput` defaults `inputMode="numeric"`,
   * so an omitted charset would silently pop the digit keypad on an alphanumeric code —
   * exactly the prod bug #1110.
   */
  charset: "alphanumeric" | "numeric";
  /**
   * Fired once the fixed-length code is fully entered. The caller wires its
   * `isSubmitting`-guarded submit here (auto-submit, #175); optional so a surface
   * that wants manual-only submit can omit it.
   */
  onComplete?: (() => void) | undefined;
}) {
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <InputOTP
          {...field}
          maxLength={length}
          autoComplete="one-time-code"
          // #1110: the mobile keyboard the widget requests. input-otp's OTPInput
          // defaults inputMode="numeric" (digits-only keypad); an alphanumeric
          // code (PVDC3R) then has its letters unreachable on a phone.
          // charset="alphanumeric" ⇒ text keyboard + uppercase key hints (matching
          // the UPPERCASE code we normalize to below); "numeric" pins the digit keypad.
          inputMode={charset === "alphanumeric" ? "text" : "numeric"}
          {...(charset === "alphanumeric"
            ? { autoCapitalize: "characters" as const }
            : {})}
          value={field.value ?? ""}
          // #1109: the reg / reset code Zitadel emits is UPPERCASE alphanumeric and
          // its compare is case-sensitive — uppercase every keystroke so a doctor
          // typing it lowercased still lands the correct value. A no-op for the
          // digit TOTP, so it is safe to apply unconditionally. input-otp calls
          // onChange with a raw string (not a DOM event).
          onChange={(v: string) => field.onChange(v.toUpperCase())}
          {...(onComplete ? { onComplete } : {})}
        >
          <InputOTPGroup>
            {Array.from({ length }, (_, i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
