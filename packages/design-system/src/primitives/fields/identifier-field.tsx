"use client";

import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "../input";
import { FormControl, FormItem, FormLabel, FormMessage } from "../form";

/**
 * `<IdentifierField>` (#197) — the email-OR-phone *union* box. This is the fifth
 * primitive (the issue named four): the login-password (`/login`) and reset
 * (`/reset`) identifier is neither pure email nor pure phone — the user types ONE
 * credential and Zitadel resolves whichever it is — so it needs the union shape
 * (`IdentifierFieldSchema`, composed by the form), not `<EmailField>` or
 * `<PhoneField>`. A bare numeric string is neither and is rejected before submit:
 * that is the exact fix for #192 (`/login`) and #196 (`/reset`).
 *
 * Always UNMASKED — this preserves current behavior and is intrinsic to a union
 * box: it must accept a free-typed email as readily as a phone, and a phone mask
 * would mangle an email mid-type. Only the OTP *sms* channel (`<PhoneField>`) masks,
 * because there the box is phone-only. No `mask` prop is exposed — both live call
 * sites are unmasked by design, and a speculative phone-only-identifier opt-in is
 * YAGNI (build-clean): add it (with a caller + test) only when a real surface needs
 * it.
 *
 * `autoComplete="username"` (not `email`/`tel`) because the box is a union — the
 * e2e selects the identifier by this attribute, so it is preserved exactly.
 *
 * i18n contract (#235): no copy lives here — the app supplies `label` / `placeholder`.
 */
export function IdentifierField<T extends FieldValues>({
  field,
  label,
  placeholder,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** Field label (app-supplied, localized). */
  label: string;
  /** Placeholder (app-supplied, localized). */
  placeholder?: string;
  /** Optional `data-testid` for the input (the e2e relies on stable test ids). */
  testId?: string;
}) {
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input
          autoComplete="username"
          placeholder={placeholder}
          data-testid={testId}
          {...field}
          value={field.value ?? ""}
          onChange={field.onChange}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
