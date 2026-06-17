"use client";

import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Input } from "../input";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "../form";

/**
 * `<PasswordField>` (#197) — the semantic password primitive. `type="password"` is
 * baked in; the call site chooses the autocomplete posture via `purpose`:
 *   • `purpose="new"`  → `autoComplete="new-password"` (registration / reset
 *     creation). The composing form pairs this with the `NewPasswordFieldSchema`
 *     fragment (the #147 upper/lower/digit/symbol baseline), and the policy hint is
 *     shown by default (when a `policyHint` string is supplied).
 *   • `purpose="current"` → `autoComplete="current-password"` (login). Paired with
 *     the permissive `CurrentPasswordFieldSchema` (min 8, no complexity) so a legacy
 *     credential still authenticates (#147); no policy hint (it is a login, not a
 *     creation).
 *
 * The widget does not pick the resolver fragment — the form composes that — but it
 * guarantees the autocomplete + policy-hint pairing is always consistent with the
 * purpose, which is the per-call wiring this primitive removes.
 *
 * i18n contract (#235): no copy lives here — the app supplies `label` and the
 * `policyHint` text (rendered only for `purpose="new"` unless overridden).
 */
export function PasswordField<T extends FieldValues>({
  field,
  purpose,
  label,
  policyHint,
  showPolicy,
  testId,
}: {
  field: ControllerRenderProps<T>;
  /** `new` (creation) or `current` (login) — drives `autoComplete` + the hint. */
  purpose: "new" | "current";
  /** Field label (app-supplied, localized). */
  label: string;
  /** Localized password-policy hint copy (app-supplied); shown when policy is on. */
  policyHint?: string;
  /**
   * Show the password-policy hint. Defaults to `true` for `purpose="new"` (the
   * creation surfaces show the complexity baseline) and `false` for `current`. The
   * hint only renders when both `showPolicy` resolves true AND a `policyHint` string
   * is supplied.
   */
  showPolicy?: boolean;
  /** Optional `data-testid` for the input (the e2e relies on stable test ids). */
  testId?: string;
}) {
  const withPolicy = showPolicy ?? purpose === "new";
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input
          type="password"
          autoComplete={purpose === "new" ? "new-password" : "current-password"}
          data-testid={testId}
          {...field}
          value={field.value ?? ""}
        />
      </FormControl>
      {withPolicy && policyHint ? (
        <FormDescription>{policyHint}</FormDescription>
      ) : null}
      <FormMessage />
    </FormItem>
  );
}
