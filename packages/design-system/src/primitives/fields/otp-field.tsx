"use client";

import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "../input";
import { FormControl, FormItem, FormLabel, FormMessage } from "../form";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../input-otp";

/**
 * `<OtpField>` (#197) — the semantic one-time-code primitive. Bakes in: fixed length
 * (`length` prop), numeric-only, `autoComplete="one-time-code"`, `maxLength`, and
 * auto-submit-on-completion (#175) — the call site cannot forget any of them.
 *
 * WHY length is a prop, not a constant: the two live OTP surfaces have DIFFERENT
 * fixed lengths — the Zitadel login email/SMS OTP is 8 digits (verified live, #153),
 * the registration / reset code is 6. Both are fixed, so both can auto-submit the
 * moment the last digit lands; only the number differs, hence a `length` prop.
 *
 * WHY two presentations (`variant`): the segmented slotted look is the default for
 * every surface (#211 unified `/login` onto it too), but the plain numeric variant
 * is retained because some surfaces / future codes may still want a single box:
 *   • `variant="slotted"` → the design-system `InputOTP` with `length` slots; its
 *     native `onComplete` drives auto-submit. Used by `/login`, `/verify`, `/reset`.
 *   • `variant="plain"`   → a plain numeric `<Input maxLength={length}>`; it strips
 *     non-digits and calls `onComplete` once `length` digits are present.
 *
 * Char set per surface: the registration (`/verify`) and reset (`/reset`) codes
 * Zitadel emits are ALPHANUMERIC (e.g. `PVDC3R`), so the slotted widget must accept
 * letters — it does, because we pass NO `pattern` to `InputOTP` (input-otp only
 * restricts input when a `pattern` is given). The login OTP is digits, but the
 * slotted widget happily accepts the digit subset, so no per-surface filter is
 * needed. The plain variant's `otpDigits` strip is digit-specific and stays plain-only.
 *
 * #212 fix — the slotted variant must spread the FULL RHF `field` (name + ref +
 * onBlur), not just `value`/`onChange`. input-otp's controlled hidden input needs a
 * real `ref` (the design-system `InputOTP` forwards it straight to that input) for
 * RHF to bind the field the same way the plain `<Input>` gets it via `{...field}`;
 * wiring only `value`+`onChange` left the slotted field half-bound and it dropped
 * every keystroke on `/reset` + `/verify`. `onChange` is set explicitly AFTER the
 * spread because input-otp calls `onChange(value: string)` with a raw string (not a
 * DOM event) — RHF's `field.onChange` ingests that string directly.
 *
 * Auto-submit + in-flight guard: the field calls `onComplete()` on completion; the
 * caller's `onComplete` is responsible for the `isSubmitting` guard (it already
 * holds the RHF form), so a double network call cannot fire if completion races a
 * manual click / Enter — identical to the pre-#197 inline logic.
 */

/** Digits only — strip the formatting an OS autofill / paste might carry so the
 * completion check sees the true code length. PLAIN variant only (the login OTP is
 * numeric); the slotted variant accepts alphanumeric codes verbatim. */
function otpDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function OtpField<T extends FieldValues>({
  field,
  length,
  label,
  variant,
  placeholder,
  onComplete,
}: {
  field: ControllerRenderProps<T>;
  /** Fixed code length — 8 for login OTP, 6 for registration/reset. */
  length: number;
  /** Label; required (the surfaces use distinct copy). */
  label: string;
  /** `slotted` (verify/reset) or `plain` (login). */
  variant: "slotted" | "plain";
  /** Placeholder for the plain variant (e.g. login `12345678`). */
  placeholder?: string | undefined;
  /**
   * Fired once the fixed-length code is fully entered. The caller wires its
   * `isSubmitting`-guarded submit here (auto-submit, #175); optional so a surface
   * that wants manual-only submit can omit it.
   */
  onComplete?: (() => void) | undefined;
}) {
  if (variant === "slotted") {
    return (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <InputOTP
            {...field}
            maxLength={length}
            autoComplete="one-time-code"
            value={field.value ?? ""}
            onChange={field.onChange}
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

  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          placeholder={placeholder}
          {...field}
          value={field.value ?? ""}
          onChange={(e) => {
            field.onChange(e);
            if (otpDigits(e.target.value).length === length) onComplete?.();
          }}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
