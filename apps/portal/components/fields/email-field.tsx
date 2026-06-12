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

/**
 * `<EmailField>` (#197) — the semantic email primitive. Bakes in the email-shape
 * validation (the resolver fragment `EmailFieldSchema`, composed by the form) plus
 * the correct HTML affordances (`type="email"` / `autoComplete="email"` /
 * `inputMode="email"`) and RU copy, so a call site never re-wires them — the gap
 * that produced #192/#196. The a11y wiring (label/aria-invalid/error) comes from the
 * design-system `<FormControl>` already; this primitive renders the whole
 * `<FormItem>` so the call site only passes the RHF `field` and an optional label.
 *
 * The raw `<Input>` lives HERE (inside the sanctioned primitive), not on the auth
 * surface — which is exactly why the ESLint gate (which scopes to
 * `apps/portal/app/{login,register,…}`) does not flag it.
 */
export function EmailField<T extends FieldValues>({
  field,
  label,
  placeholder,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** Field label; defaults to the shared `common.email` RU string. */
  label?: string;
  /** Placeholder; defaults to the shared `common.emailPlaceholder`. */
  placeholder?: string;
  /** Optional `data-testid` for the input (the e2e relies on stable test ids). */
  testId?: string;
}) {
  const tc = useTranslations("common");
  return (
    <FormItem>
      <FormLabel>{label ?? tc("email")}</FormLabel>
      <FormControl>
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={placeholder ?? tc("emailPlaceholder")}
          data-testid={testId}
          {...field}
          // RHF may hold `undefined` for an optional identifier (the register email
          // field is optional in the dual-identifier schema); coerce to "" so the
          // input stays controlled.
          value={field.value ?? ""}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
