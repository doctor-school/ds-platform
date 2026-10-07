"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
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
 * digits (003 EARS-29 amended, #2636 — the one code step, `CODE_STEP_LENGTH`),
 * but the admin TOTP challenge is a digit code of its own length. Each is
 * fixed, so each auto-submits the moment the last character lands.
 *
 * Char set per surface: `charset="numeric"` (every mailed/texted code and the
 * admin TOTP) passes input-otp's `REGEXP_ONLY_DIGITS` `pattern`, so a typed or
 * pasted letter never reaches a cell. `"alphanumeric"` passes NO `pattern`
 * (input-otp only restricts input when one is given) and upper-cases the value.
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
   * (#1110) and the characters it accepts. REQUIRED so no surface can silently
   * inherit the wrong one:
   *   • `"numeric"` (every mailed/texted code and the admin TOTP) → `inputMode="numeric"`
   *     — the digit keypad — plus the digits-only `pattern` (#2636).
   *   • `"alphanumeric"` → `inputMode="text"` + `autoCapitalize="characters"` — the
   *     full keyboard with uppercase key hints matching the upper-cased value.
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
          // #1110: the mobile keyboard the widget requests — the digit keypad for
          // a numeric code, the full keyboard (uppercase hints) for alphanumeric.
          inputMode={charset === "alphanumeric" ? "text" : "numeric"}
          {...(charset === "alphanumeric"
            ? { autoCapitalize: "characters" as const }
            : // #2636: digits only — input-otp drops a non-matching keystroke and
              // refuses a non-matching paste, so no letter ever fills a cell.
              { pattern: REGEXP_ONLY_DIGITS })}
          value={field.value ?? ""}
          // #1109: an alphanumeric value is upper-cased so a lowercase keystroke
          // lands the case the code was issued in; a no-op for digits. input-otp
          // calls onChange with a raw string (not a DOM event).
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
