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
 * `<PhoneField>` (#197) — the semantic phone primitive. Bakes in E.164 validation
 * (the `PhoneFieldSchema` fragment, composed by the form) AND the input mask
 * (`maskPhoneInput`: RU `8…`→`+7…` domestic, international pass-through) so the
 * stored value is always submit-shaped — the call site cannot forget the mask the
 * way the OTP-SMS box originally did before #192. `type/autoComplete/inputMode` are
 * all `tel`. The mask is non-negotiable here: a phone field that does not mask is
 * precisely the defect this primitive exists to prevent.
 */
export function PhoneField<T extends FieldValues>({
  field,
  label,
  placeholder,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** Field label; defaults to the shared `common.phone` RU string. */
  label?: string;
  /** Placeholder; defaults to the shared `common.phonePlaceholder` (`+79991234567`). */
  placeholder?: string;
  /** Optional `data-testid` for the input (the e2e relies on stable test ids). */
  testId?: string;
}) {
  const tc = useTranslations("common");
  return (
    <FormItem>
      <FormLabel>{label ?? tc("phone")}</FormLabel>
      <FormControl>
        <Input
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder={placeholder ?? tc("phonePlaceholder")}
          data-testid={testId}
          {...field}
          value={field.value ?? ""}
          // Mask every keystroke into an E.164-valid `+<digits>` value, so the box
          // can only ever hold a phone and the stored value is what the BFF receives.
          onChange={(e) => field.onChange(maskPhoneInput(e.target.value))}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
