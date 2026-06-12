"use client";

import { useTranslations } from "next-intl";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "@ds/design-system/input";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";

/**
 * `<PasswordField>` (#197) — the semantic password primitive. `type="password"` is
 * baked in; the call site chooses the autocomplete posture via `purpose`:
 *   • `purpose="new"`  → `autoComplete="new-password"` (registration / reset
 *     creation). The composing form pairs this with the `NewPasswordFieldSchema`
 *     fragment (the #147 upper/lower/digit/symbol baseline), and the policy hint is
 *     shown by default.
 *   • `purpose="current"` → `autoComplete="current-password"` (login). Paired with
 *     the permissive `CurrentPasswordFieldSchema` (min 8, no complexity) so a legacy
 *     credential still authenticates (#147); no policy hint (it is a login, not a
 *     creation).
 *
 * The widget does not pick the resolver fragment — the form composes that — but it
 * guarantees the autocomplete + policy-hint pairing is always consistent with the
 * purpose, which is the per-call wiring this primitive removes.
 */
export function PasswordField<T extends FieldValues>({
  field,
  purpose,
  label,
  showPolicy,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** `new` (creation) or `current` (login) — drives `autoComplete` + the hint. */
  purpose: "new" | "current";
  /** Label; defaults to the shared `common.password` RU string. */
  label?: string;
  /**
   * Show the password-policy hint. Defaults to `true` for `purpose="new"` (the
   * creation surfaces show the complexity baseline) and `false` for `current`.
   */
  showPolicy?: boolean;
  /** Optional `data-testid` for the input (the e2e relies on stable test ids). */
  testId?: string;
}) {
  const tc = useTranslations("common");
  const withPolicy = showPolicy ?? purpose === "new";
  return (
    <FormItem>
      <FormLabel>{label ?? tc("password")}</FormLabel>
      <FormControl>
        <Input
          type="password"
          autoComplete={purpose === "new" ? "new-password" : "current-password"}
          data-testid={testId}
          {...field}
          value={field.value ?? ""}
        />
      </FormControl>
      {withPolicy ? (
        <FormDescription>{tc("passwordPolicy")}</FormDescription>
      ) : null}
      <FormMessage />
    </FormItem>
  );
}
