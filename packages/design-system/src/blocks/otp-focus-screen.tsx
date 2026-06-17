"use client";

import * as React from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Button } from "../primitives/button";
import { OtpField } from "../primitives/fields/otp-field";

/**
 * `<OtpFocusScreen>` (#227, absorbed into #235) — a reusable, focused OTP-entry
 * block. When a code has been requested, the surface (login-OTP / register-verify /
 * reset) renders THIS instead of the full request-form chrome, so the user sees
 * only what the focus-screen decision (227) prescribes and CANNOT wander off the
 * issued challenge:
 *
 *   renders ONLY → masked destination + code input + submit + resend(cooldown) +
 *   change-method/back (+ an optional error slot).
 *
 * By construction it omits any channel switcher and any secondary links (create /
 * forgot) — those props simply do not exist, so a surface physically cannot
 * re-introduce the #227 papercut through this block.
 *
 * Copy-as-props / i18n contract (#235): EVERY visible string is a prop — `title`,
 * the past-tense "code sent to {masked}" `sentToLabel` (the app composes it with the
 * already-masked destination), the `submitLabel`, the `resendLabel` +
 * `resendCountdownLabel(seconds)`, and the `changeMethodLabel`. No copy lives in the
 * package.
 *
 * Behavior (preserved from `verify/page.tsx`): the code field auto-submits the
 * moment the fixed-length code lands, via `<OtpField onComplete>`. The app owns the
 * RHF form and the `isSubmitting` guard, so it passes a guarded `onComplete` and the
 * current `isSubmitting` (to disable the submit button + skip a racing auto-submit).
 * The masked destination is computed by the app (reuse `maskDestination` from this
 * package) and passed pre-masked — the block never sees the raw destination.
 *
 * Resend cooldown: the block owns a live countdown. It (re)starts whenever the
 * `cooldownSeconds` prop *value* changes — the app bumps it (e.g. `setCooldown(c =>
 * ({ s: 30, n: c.n + 1 }))`) on a successful resend; while counting down the resend
 * control is disabled and shows `resendCountdownLabel(remaining)`, then re-enables
 * and shows `resendLabel`. Pass `cooldownSeconds={0}` to start enabled.
 */
export function OtpFocusScreen<T extends FieldValues>({
  field,
  length,
  variant = "slotted",
  placeholder,
  title,
  sentToLabel,
  codeLabel,
  submitLabel,
  resendLabel,
  resendCountdownLabel,
  changeMethodLabel,
  cooldownSeconds = 0,
  isSubmitting = false,
  onComplete,
  onSubmit,
  onResend,
  onChangeMethod,
  error,
  submitTestId,
  resendTestId,
  changeMethodTestId,
}: {
  /** RHF controller for the code field — the app owns the form/resolver. */
  field: ControllerRenderProps<T>;
  /** Fixed code length (8 for login OTP, 6 for register/reset). */
  length: number;
  /** OTP presentation — defaults to the unified slotted look (#211). */
  variant?: "slotted" | "plain";
  /** Placeholder for the plain variant. */
  placeholder?: string;

  /** Screen title (app-supplied, localized). */
  title: React.ReactNode;
  /**
   * Past-tense confirmation naming the masked destination, e.g. composed by the app
   * as «Код отправлен на +7•••••31223». The app masks the destination itself
   * (reuse `maskDestination`) — the block never sees the raw value.
   */
  sentToLabel: React.ReactNode;
  /** Label for the code input. */
  codeLabel: string;
  /** Submit button copy. */
  submitLabel: React.ReactNode;
  /** Resend control copy while enabled. */
  resendLabel: React.ReactNode;
  /** Resend control copy while counting down; receives the remaining seconds. */
  resendCountdownLabel: (secondsRemaining: number) => React.ReactNode;
  /** Change-method / back control copy. */
  changeMethodLabel: React.ReactNode;

  /**
   * Resend cooldown in seconds. The countdown (re)starts whenever this VALUE
   * changes; the app bumps it on a successful resend. `0` = resend enabled now.
   */
  cooldownSeconds?: number;
  /** App-owned in-flight flag — disables submit + guards the auto-submit race. */
  isSubmitting?: boolean;

  /** Fired when the fixed-length code completes (app wires the guarded auto-submit). */
  onComplete?: (() => void) | undefined;
  /** Manual submit handler (the `<form onSubmit>` the app owns). */
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  /** Resend handler — the app re-requests the code and bumps `cooldownSeconds`. */
  onResend: () => void;
  /** Change-method / back handler — returns the surface to channel selection. */
  onChangeMethod: () => void;

  /** Optional error slot (already-mapped, localized message). */
  error?: React.ReactNode;

  submitTestId?: string;
  resendTestId?: string;
  changeMethodTestId?: string;
}) {
  // Live resend countdown, owned by the block. Re-seed whenever the app changes the
  // cooldown value (a successful resend); `0` leaves resend immediately enabled.
  const [remaining, setRemaining] = React.useState(cooldownSeconds);
  React.useEffect(() => {
    setRemaining(cooldownSeconds);
  }, [cooldownSeconds]);
  React.useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  const resendDisabled = remaining > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground" data-testid="otp-sent-to">
          {sentToLabel}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <OtpField
          field={field}
          length={length}
          variant={variant}
          label={codeLabel}
          placeholder={placeholder}
          onComplete={onComplete}
        />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
          data-testid={submitTestId}
        >
          {submitLabel}
        </Button>
      </form>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onChangeMethod}
          data-testid={changeMethodTestId}
        >
          {changeMethodLabel}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={resendDisabled}
          onClick={onResend}
          data-testid={resendTestId}
        >
          {resendDisabled ? resendCountdownLabel(remaining) : resendLabel}
        </Button>
      </div>
    </div>
  );
}
