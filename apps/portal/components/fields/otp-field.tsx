"use client";

import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "@ds/design-system/input";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@ds/design-system/input-otp";

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
 * WHY two presentations (`variant`): preserving EXACT current behavior beats forcing
 * one widget. `/verify` and `/reset` use the slotted `InputOTP` (fixed-width slots,
 * native `onComplete`); `/login` uses a plain numeric `Input` (the 8-digit code is
 * longer/looser than a 6-slot widget wants — see #175). Rather than re-style either,
 * `<OtpField>` wraps whichever the surface already used:
 *   • `variant="slotted"` → the design-system `InputOTP` with `length` slots; its
 *     native `onComplete` drives auto-submit.
 *   • `variant="plain"`   → a plain numeric `<Input maxLength={length}>`; it strips
 *     non-digits and calls `onComplete` once `length` digits are present.
 *
 * Auto-submit + in-flight guard: the field calls `onComplete()` on completion; the
 * caller's `onComplete` is responsible for the `isSubmitting` guard (it already
 * holds the RHF form), so a double network call cannot fire if completion races a
 * manual click / Enter — identical to the pre-#197 inline logic.
 */

/** Digits only — strip the formatting an OS autofill / paste might carry so the
 * completion check sees the true code length. (Plain variant only; the slotted
 * widget is digit-constrained by its slots.) */
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
  placeholder?: string;
  /**
   * Fired once the fixed-length code is fully entered. The caller wires its
   * `isSubmitting`-guarded submit here (auto-submit, #175); optional so a surface
   * that wants manual-only submit can omit it.
   */
  onComplete?: () => void;
}) {
  if (variant === "slotted") {
    return (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <InputOTP
            maxLength={length}
            autoComplete="one-time-code"
            value={field.value ?? ""}
            onChange={field.onChange}
            onComplete={onComplete}
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
