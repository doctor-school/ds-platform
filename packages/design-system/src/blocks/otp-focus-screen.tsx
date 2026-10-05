"use client";

import * as React from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";

import { Alert } from "../primitives/alert";
import { Button } from "../primitives/button";
import { OtpField } from "../primitives/fields/otp-field";
import { useResendCountdown } from "./use-resend-countdown";

/**
 * The one code every flow mails or texts (003 EARS-29 amended, #2555): six
 * characters, upper-case letters and digits. The step has no other length —
 * no eight-cell, digits-only step exists on any host (003 EARS-42).
 */
export const CODE_STEP_LENGTH = 6;

/** The step's addressable parts — every id is the caller's. */
export interface OtpFocusScreenTestIds {
  submit?: string;
  resend?: string;
  back?: string;
  notice?: string;
  succeeded?: string;
}

/**
 * `<OtpFocusScreen>` — the ONE code step (003 EARS-42, canvas
 * `design-source/auth.dc.html` 64-85 «ШАГ КОДА»). Login by code (after the code
 * was sent), the post-registration confirmation and a re-registration all draw
 * THIS step inside their card; the card itself carries the step's heading
 * («Проверьте почту» / «Проверьте телефон») and the «Мы отправили код на …»
 * line, so the step renders only:
 *
 *   code label + six cells → «Код принят» row → primary → back + resend row →
 *   the after-resend notice.
 *
 * By construction it has no channel switcher and no secondary links — those
 * props do not exist, so no surface can re-introduce the #227 papercut here.
 *
 * Copy-as-props (#235): every visible string is a prop; no copy lives in the
 * package. The code is entered into `<OtpField>`'s slotted alphanumeric
 * variant (text keyboard, upper-cased), and the app's guarded `onComplete`
 * auto-submits on the sixth character (003 EARS-22 amended).
 *
 * Resend cooldown: the step owns a live countdown that (re)starts whenever the
 * `cooldownSeconds` VALUE changes or the `resendNonce` counter is bumped, so a
 * consumer restarts it without a `key` remount (#266). `cooldownSeconds={0}`
 * starts enabled.
 */
export function OtpFocusScreen<T extends FieldValues>({
  field,
  codeLabel,
  submitLabel,
  backLabel,
  resendLabel,
  resendCountdownLabel,
  cooldownSeconds = 0,
  resendNonce = 0,
  isSubmitting = false,
  resendPending = false,
  succeeded = false,
  succeededLabel,
  notice,
  onComplete,
  onSubmit,
  onResend,
  onBack,
  captchaSlot,
  testIds = {},
}: {
  /** RHF controller for the code field — the app owns the form/resolver. */
  field: ControllerRenderProps<T>;
  /** Label above the six cells («Код из письма» / «Код из сообщения»). */
  codeLabel: string;
  /** Primary button copy. */
  submitLabel: React.ReactNode;
  /** The back control («← Изменить способ» / «← Изменить почту»). */
  backLabel: React.ReactNode;
  /** Resend control copy while enabled. */
  resendLabel: React.ReactNode;
  /** Resend control copy while counting down; receives the remaining seconds. */
  resendCountdownLabel: (secondsRemaining: number) => React.ReactNode;
  /** Resend cooldown in seconds; `0` = resend enabled now. */
  cooldownSeconds?: number;
  /** Monotonic resend counter — bump on each successful resend (#266). */
  resendNonce?: number;
  /** App-owned in-flight flag — the primary's `Button.loading` affordance. */
  isSubmitting?: boolean;
  /** An in-flight resend (e.g. its challenge) — the resend control's busy state. */
  resendPending?: boolean;
  /** Server-confirmed acceptance (canvas 73-75) — never set optimistically. */
  succeeded?: boolean;
  /** The «Код принят — входим…» row copy, drawn while `succeeded`. */
  succeededLabel?: React.ReactNode;
  /** The after-resend notice (canvas 81-83); absent → nothing renders. */
  notice?: React.ReactNode;
  /** Fired when the sixth character lands (app wires the guarded auto-submit). */
  onComplete?: (() => void) | undefined;
  /** Manual submit handler (the `<form onSubmit>` the app owns). */
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  /** Resend handler — the app re-requests the code and bumps `resendNonce`. */
  onResend: () => void;
  /** Back handler — the surface returns to where the code was asked for. */
  onBack: () => void;
  /**
   * The bot-protection challenge, rendered INSIDE the form directly above the
   * primary (canvas 139-143) — invisible unless the provider asks.
   */
  captchaSlot?: React.ReactNode;
  testIds?: OtpFocusScreenTestIds;
}) {
  const remaining = useResendCountdown(cooldownSeconds, resendNonce);
  const resendDisabled = remaining > 0;

  return (
    // Canvas 66 — one 16px column.
    <div className="flex flex-col gap-4">
      {/* Same pre-hydration rule as every auth form: a native submit before the
          bundle loads must POST, never GET the one-time code into the URL and
          the access logs. */}
      <form
        method="post"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <OtpField
          field={field}
          length={CODE_STEP_LENGTH}
          charset="alphanumeric"
          label={codeLabel}
          onComplete={onComplete}
        />

        {/* Canvas 73-75 — confirms acceptance while the app navigates on. */}
        {succeeded ? (
          <Alert variant="success" data-testid={testIds.succeeded}>
            {succeededLabel}
          </Alert>
        ) : null}

        {captchaSlot}

        <Button
          type="submit"
          className="w-full"
          loading={isSubmitting}
          data-testid={testIds.submit}
        >
          {submitLabel}
        </Button>
      </form>

      {/* Canvas 77-80 — back on the left, resend on the right; wraps when cramped. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid={testIds.back}
          // `shrink-0` — the back control keeps its size; the resend label is
          // the flex item that yields when the row is cramped (#542).
          // `-mx-4 -my-2` cancel the ghost padding so the label sits on the
          // content edge, as the canvas back control does (auth.dc.html 78).
          className="-mx-4 -my-2 shrink-0"
        >
          {backLabel}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={resendDisabled || resendPending}
          loading={resendPending}
          onClick={onResend}
          data-testid={testIds.resend}
          // `tabular-nums` — fixed-width countdown digits, no jitter (#267);
          // `min-w-0` + `whitespace-normal` let the label wrap (#542);
          // `font-extrabold` — canvas 378 draws it at 13px / 800.
          className="min-w-0 whitespace-normal text-right font-extrabold tabular-nums"
        >
          {resendDisabled ? resendCountdownLabel(remaining) : resendLabel}
        </Button>
      </div>

      {/* Canvas 81-83 — neutral after-resend notice; a success ack, not an
          error. Canvas 12.5px has no type-scale step; `caption` is nearest. */}
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="text-caption leading-normal text-muted-foreground"
          data-testid={testIds.notice}
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
