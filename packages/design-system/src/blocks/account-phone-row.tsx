"use client";

import * as React from "react";

import {
  RequestPhoneCodeRequestSchema,
  normalisePhoneEntry,
  type MyProfile,
} from "@ds/schemas";

import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { FormError } from "../primitives/form";
import { maskPhoneInput } from "../primitives/fields/phone-mask";
import { Input } from "../primitives/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../primitives/input-otp";
import { Link as DsLink } from "../primitives/link";
import { LOGIN_RESEND_COOLDOWN_SECONDS } from "./login-card";
import { useResendCountdown } from "./use-resend-countdown";

/**
 * `<AccountPhoneRow>` (003 EARS-47…51, 59; #2449/#2776) — the confirmable
 * «Телефон» row of the shared account profile, from the vendored
 * `design-source/account-profile.dc.html` («Разделы», phone switch states:
 * не указан / из заявки / ввод номера / код отправлен / не подтверждён /
 * подтверждён; errors «неверный код» / «лимит»).
 *
 * The row is a small state machine over the HOST's transport
 * ({@link AccountPhoneActions}): the block never talks HTTP and never decides
 * what an error means — the host classifies a rejection, the block picks the
 * copy. Every state the row shows is either the profile the host read
 * (EARS-27/50) or an answer the server gave in this session (the code request,
 * the confirmation), so it never shows a number as confirmed that the server
 * did not confirm.
 *
 * Enumeration safety (EARS-51) is the server's: a number confirmed on another
 * account answers `code_sent` exactly like a free one, and its confirmation
 * fails with the same generic wrong-code outcome — so this row has, and needs,
 * no «number taken» branch.
 *
 * «Не подтверждён» is session-local on purpose (EARS-49): once a code was
 * requested the account has no confirmed phone and the server keeps no pending
 * number of its own, so a reload shows the profile as read, not the number the
 * user abandoned.
 */

/** Resend cooldown — the SMS sign-in code step's own timer (003 EARS-42/59). */
export const ACCOUNT_PHONE_RESEND_COOLDOWN_SECONDS =
  LOGIN_RESEND_COOLDOWN_SECONDS;

/** The six-digit SMS code (EARS-48, as EARS-41). */
const PHONE_CODE_LENGTH = 6;

/** What a rejected phone call means to the user — the host decides which. */
export type AccountPhoneFailure = "invalid" | "throttled" | "unavailable";

/** The host's transport for the two phone doors (EARS-47/48). */
export interface AccountPhoneActions {
  /** Request (or re-send) the code for the number as typed. */
  requestCode: (phone: string) => Promise<"code_sent" | "already_confirmed">;
  /** Submit the code; resolves the phone the server now holds confirmed. */
  confirm: (code: string) => Promise<string>;
  /** Classify a rejection of either call. */
  classifyError: (error: unknown) => AccountPhoneFailure;
}

/** Every RU string the phone row renders. */
export interface AccountPhoneCopy {
  add: string;
  confirm: string;
  change: string;
  verified: string;
  unconfirmedHelper: string;
  suggestedHelper: string;
  confirmedNote: string;
  inputLabel: string;
  placeholder: string;
  send: string;
  cancel: string;
  codeSentTo: string;
  codeLabel: string;
  back: string;
  resend: string;
  resendCountdown: (secondsRemaining: number) => string;
  wrongCode: string;
  throttled: string;
  unavailable: string;
}

type Shown = "none" | "suggested" | "unconfirmed" | "confirmed";

type Phase =
  | { kind: "display"; shown: Shown; phone: string | null; note: boolean }
  | { kind: "entry" }
  | { kind: "code" };

/** RU numbers render as «+7 913 402-88-71»; anything else stays as given. */
export function formatPhoneForDisplay(value: string): string {
  const e164 = normalisePhoneEntry(value);
  const digits = e164.replace(/\D/g, "");
  if (e164.startsWith("+7") && digits.length === 11) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  return value;
}

function initialPhase(profile: MyProfile): Phase {
  if (profile.phone && profile.phoneVerified) {
    return {
      kind: "display",
      shown: "confirmed",
      phone: profile.phone,
      note: false,
    };
  }
  if (profile.phone) {
    return {
      kind: "display",
      shown: "unconfirmed",
      phone: profile.phone,
      note: false,
    };
  }
  if (profile.suggestedPhone) {
    return {
      kind: "display",
      shown: "suggested",
      phone: profile.suggestedPhone,
      note: false,
    };
  }
  return { kind: "display", shown: "none", phone: null, note: false };
}

/** The verified badge — the email row's AA remap (#270), reused for the phone. */
export function VerifiedBadge({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  return (
    // AA remap (#270 precedent): the canvas paints the badge green, which
    // fails 4.5:1 on the light background — the LABEL takes AA ink and only
    // the decorative check keeps the success hue (WCAG 1.4.11 exempt).
    <Badge
      className="gap-1.5 border-2 border-current bg-transparent text-foreground"
      data-testid={testId}
    >
      <span aria-hidden="true" className="text-success">
        ✓
      </span>
      {label}
    </Badge>
  );
}

/** The underlined accent action of a row («Изменить», «Отмена»). */
function RowAction({
  onClick,
  children,
  testId,
  className = "",
  buttonRef,
}: {
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <DsLink asChild className={`text-sm font-extrabold ${className}`}>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        ref={buttonRef}
      >
        {children}
      </button>
    </DsLink>
  );
}

export function AccountPhoneRow({
  profile,
  copy,
  emptyLabel,
  actions,
}: {
  profile: MyProfile;
  copy: AccountPhoneCopy;
  /** The explicit empty state («не указан», EARS-28). */
  emptyLabel: string;
  actions: AccountPhoneActions;
}) {
  const [phase, setPhase] = React.useState<Phase>(() => initialPhase(profile));
  // The display state the entry returns to on «Отмена».
  const [previous, setPrevious] = React.useState<Phase>(phase);
  const [draft, setDraft] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<AccountPhoneFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  // A code went out in this session: the account no longer holds a confirmed
  // phone (EARS-47 displacement), so leaving shows the number unconfirmed.
  const [codeRequested, setCodeRequested] = React.useState(false);
  const [resendNonce, setResendNonce] = React.useState(0);
  const remaining = useResendCountdown(
    phase.kind === "code" ? ACCOUNT_PHONE_RESEND_COOLDOWN_SECONDS : 0,
    resendNonce,
  );

  // A host re-read with different phone fields re-seeds the row; a display-name
  // save (a new profile object, same phone) must not drop a step in flight.
  const { phone, phoneVerified, suggestedPhone } = profile;
  const seeded = React.useRef(true);
  React.useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    const next = initialPhase(profile);
    setPhase(next);
    setPrevious(next);
    setCodeRequested(false);
    setError(null);
  }, [phone, phoneVerified, suggestedPhone]);

  // Leaving a step unmounts the focused control; the focus goes back to the
  // row action instead of falling to the page.
  const actionRef = React.useRef<HTMLButtonElement>(null);
  const refocusAction = React.useRef(false);
  React.useEffect(() => {
    if (phase.kind === "display" && refocusAction.current) {
      refocusAction.current = false;
      actionRef.current?.focus();
    }
  }, [phase]);

  // A malformed-number refusal of the code REQUEST is not a wrong code: no
  // code exists yet (003 EARS-48 names the code-step failure only).
  const requestFailure = (err: unknown): AccountPhoneFailure => {
    const kind = actions.classifyError(err);
    return kind === "invalid" ? "unavailable" : kind;
  };

  const draftValid = RequestPhoneCodeRequestSchema.safeParse({
    phone: draft,
  }).success;

  function open() {
    if (phase.kind !== "display") return;
    setPrevious({ ...phase, note: false });
    setDraft(
      phase.shown === "suggested" || phase.shown === "unconfirmed"
        ? (phase.phone ?? "")
        : "",
    );
    setError(null);
    setPhase({ kind: "entry" });
  }

  function showUnconfirmed() {
    refocusAction.current = true;
    setError(null);
    setCode("");
    setPhase({
      kind: "display",
      shown: "unconfirmed",
      phone: draft,
      note: false,
    });
  }

  function cancel() {
    if (codeRequested) showUnconfirmed();
    else {
      refocusAction.current = true;
      setError(null);
      setPhase(previous);
    }
  }

  async function send() {
    if (!draftValid || pending) return;
    setPending(true);
    setError(null);
    try {
      const status = await actions.requestCode(draft);
      if (status === "already_confirmed") {
        refocusAction.current = true;
        setCodeRequested(false);
        setPhase({
          kind: "display",
          shown: "confirmed",
          phone: normalisePhoneEntry(draft),
          note: false,
        });
      } else {
        setCodeRequested(true);
        setCode("");
        setResendNonce((n) => n + 1);
        setPhase({ kind: "code" });
      }
    } catch (err) {
      setError(requestFailure(err));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (pending || remaining > 0 || error === "throttled") return;
    setPending(true);
    setError(null);
    setCode("");
    try {
      await actions.requestCode(draft);
      setResendNonce((n) => n + 1);
    } catch (err) {
      setError(requestFailure(err));
    } finally {
      setPending(false);
    }
  }

  async function submitCode(value: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const confirmed = await actions.confirm(value);
      refocusAction.current = true;
      setCodeRequested(false);
      setCode("");
      setPhase({
        kind: "display",
        shown: "confirmed",
        phone: confirmed,
        note: true,
      });
    } catch (err) {
      setError(actions.classifyError(err));
    } finally {
      setPending(false);
    }
  }

  const errorText =
    error === "invalid"
      ? copy.wrongCode
      : error === "throttled"
        ? copy.throttled
        : error === "unavailable"
          ? copy.unavailable
          : null;

  if (phase.kind === "entry") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <label
          htmlFor="profile-phone-input"
          className="text-xs font-bold text-foreground"
        >
          {copy.inputLabel}
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <Input
            id="profile-phone-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={copy.placeholder}
            value={draft}
            onChange={(e) => {
              setDraft(maskPhoneInput(e.target.value));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape") cancel();
            }}
            maxLength={32}
            // Read-only while the code is requested: the SMS goes to the
            // number the code step then names.
            readOnly={pending}
            autoFocus
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? "profile-phone-error" : undefined}
            className="min-w-0 shrink grow-0 basis-64"
            data-testid="profile-phone-input"
          />
          <Button
            type="button"
            onClick={() => void send()}
            disabled={!draftValid}
            loading={pending}
            data-testid="profile-phone-send"
          >
            {copy.send}
          </Button>
          <RowAction onClick={cancel} testId="profile-phone-cancel">
            {copy.cancel}
          </RowAction>
        </div>
        {errorText ? (
          <FormError id="profile-phone-error">{errorText}</FormError>
        ) : null}
      </div>
    );
  }

  if (phase.kind === "code") {
    const wrong = error === "invalid";
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p
          className="text-sm font-semibold leading-normal text-muted-foreground"
          data-testid="profile-phone-code-sent"
        >
          {copy.codeSentTo}{" "}
          <b className="whitespace-nowrap text-foreground">
            {formatPhoneForDisplay(draft)}
          </b>
        </p>
        <InputOTP
          maxLength={PHONE_CODE_LENGTH}
          value={code}
          onChange={(v: string) => {
            setCode(v.replace(/\D/g, ""));
            if (error === "invalid") setError(null);
          }}
          onComplete={(v: string) => void submitCode(v)}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          pasteTransformer={(raw: string) => raw.replace(/\D/g, "")}
          // Read-only, not disabled: a browser moves focus off a disabled
          // field, and the doctor corrects a wrong code from the keyboard.
          readOnly={pending}
          autoFocus
          aria-label={copy.codeLabel}
          aria-invalid={wrong ? true : undefined}
          aria-describedby={errorText ? "profile-phone-code-error" : undefined}
          data-testid="profile-phone-code"
        >
          <InputOTPGroup>
            {Array.from({ length: PHONE_CODE_LENGTH }, (_, i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className={wrong ? "border-destructive-text" : undefined}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {errorText ? (
          <FormError id="profile-phone-code-error">{errorText}</FormError>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={showUnconfirmed}
            data-testid="profile-phone-back"
            className="-my-1.5 shrink-0 px-2 py-1.5 font-bold focus-visible:shadow-focus-inset"
          >
            {copy.back}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={remaining > 0 || error === "throttled" || pending}
            onClick={() => void resend()}
            data-testid="profile-phone-resend"
            className="min-w-0 whitespace-normal font-extrabold tabular-nums"
          >
            {remaining > 0 ? copy.resendCountdown(remaining) : copy.resend}
          </Button>
        </div>
      </div>
    );
  }

  const actionLabel =
    phase.shown === "none"
      ? copy.add
      : phase.shown === "confirmed"
        ? copy.change
        : copy.confirm;
  const helper =
    phase.shown === "suggested"
      ? copy.suggestedHelper
      : phase.shown === "unconfirmed"
        ? copy.unconfirmedHelper
        : null;

  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 flex-wrap items-center gap-3">
          <span
            className={
              phase.phone ? "font-bold" : "font-semibold text-muted-foreground"
            }
            data-testid="profile-phone"
          >
            {phase.phone ? formatPhoneForDisplay(phase.phone) : emptyLabel}
          </span>
          {phase.shown === "confirmed" ? (
            <VerifiedBadge
              label={copy.verified}
              testId="profile-phone-verified"
            />
          ) : null}
        </span>
        {helper ? (
          <span
            className="text-caption font-semibold text-muted-foreground"
            data-testid="profile-phone-helper"
          >
            {helper}
          </span>
        ) : null}
        {phase.note ? (
          <span
            role="status"
            className="mt-1 flex w-fit max-w-full items-center gap-2 border-2 border-success px-3 py-2 text-caption font-bold text-foreground"
            data-testid="profile-phone-note"
          >
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            {copy.confirmedNote}
          </span>
        ) : null}
      </span>
      <RowAction
        onClick={open}
        testId="profile-phone-action"
        buttonRef={actionRef}
        className="self-start layout:self-auto"
      >
        {actionLabel}
      </RowAction>
    </>
  );
}
