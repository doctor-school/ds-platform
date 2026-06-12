"use client";

import { useTranslations } from "next-intl";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "@ds/design-system/input";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";

import { maskPhoneInput } from "./phone-mask";

/**
 * `<IdentifierField>` (#197) — the email-OR-phone *union* box. This is the fifth
 * primitive (the issue named four): the login-password (`/login`) and reset
 * (`/reset`) identifier is neither pure email nor pure phone — the user types ONE
 * credential and Zitadel resolves whichever it is — so it needs the union shape
 * (`IdentifierFieldSchema`, composed by the form), not `<EmailField>` or
 * `<PhoneField>`. A bare numeric string is neither and is rejected before submit:
 * that is the exact fix for #192 (`/login`) and #196 (`/reset`).
 *
 * UNMASKED by default — preserving current behavior. The login-password / reset
 * identifier box is intentionally not phone-masked: it must accept a free-typed
 * email as readily as a phone, and masking would mangle an email mid-type. Only the
 * OTP *sms* channel (`<PhoneField>`) masks, because there the box is phone-only.
 * `mask` is exposed as an opt-in for a hypothetical phone-only identifier surface,
 * but defaults off so the two live call sites keep their unmasked behavior.
 *
 * `autoComplete="username"` (not `email`/`tel`) because the box is a union — the
 * e2e selects the identifier by this attribute, so it is preserved exactly.
 */
export function IdentifierField<T extends FieldValues>({
  field,
  label,
  placeholder,
  mask = false,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** Label; defaults to the shared `common.emailOrPhone` RU string. */
  label?: string;
  /** Placeholder; defaults to the shared `common.identifierPlaceholder`. */
  placeholder?: string;
  /** Opt-in phone masking. Default OFF — preserves the unmasked union behavior. */
  mask?: boolean;
  /** Optional `data-testid` for the input (the e2e relies on stable test ids). */
  testId?: string;
}) {
  const tc = useTranslations("common");
  return (
    <FormItem>
      <FormLabel>{label ?? tc("emailOrPhone")}</FormLabel>
      <FormControl>
        <Input
          autoComplete="username"
          placeholder={placeholder ?? tc("identifierPlaceholder")}
          data-testid={testId}
          {...field}
          value={field.value ?? ""}
          onChange={
            mask
              ? (e) => field.onChange(maskPhoneInput(e.target.value))
              : field.onChange
          }
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
