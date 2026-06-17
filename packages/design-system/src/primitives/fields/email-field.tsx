"use client";

import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "../input";
import { FormControl, FormItem, FormLabel, FormMessage } from "../form";

/**
 * `<EmailField>` (#197) — the semantic email primitive. Bakes in the email-shape
 * validation (the resolver fragment `EmailFieldSchema`, composed by the form) plus
 * the correct HTML affordances (`type="email"` / `autoComplete="email"` /
 * `inputMode="email"`), so a call site never re-wires them — the gap that produced
 * #192/#196. The a11y wiring (label/aria-invalid/error) comes from the design-system
 * `<FormControl>` already; this primitive renders the whole `<FormItem>` so the call
 * site only passes the RHF `field`, a `label`, and a `placeholder`.
 *
 * i18n contract (#235): this primitive lives in `@ds/design-system` and therefore
 * carries NO copy of its own — the consuming app passes the localized `label` /
 * `placeholder` strings. The raw `<Input>` lives HERE (inside the sanctioned
 * primitive), not on the auth surface — which is why the ESLint gate (scoped to
 * `apps/portal/app/{login,register,…}`) does not flag it.
 */
export function EmailField<T extends FieldValues>({
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
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={placeholder}
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
