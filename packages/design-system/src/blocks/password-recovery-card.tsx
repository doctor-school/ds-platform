"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Button } from "../primitives/button";
import { Link as DsLink } from "../primitives/link";
import { Form, FormField, FormError } from "../primitives/form";
import { IdentifierField, OtpField, PasswordField } from "../primitives/fields";
import { AuthCard } from "./auth-card";
import { maskDestination } from "./mask-destination";
import { useResendCountdown } from "./use-resend-countdown";

/**
 * `<PasswordRecoveryCard>` (#1666 slice B) — the ONE canonical password-recovery
 * composition both storefronts mount (AGENTS.md §6 «Cross-front capability reuse
 * before invention», ADR-0013 A1). Lifted VERBATIM out of
 * `apps/portal/app/reset/page.tsx` (#131 → #196/#197 → #212 → #267 → #326 → #542):
 * same elements, order, classes, `data-testid`s and state presentation — only the
 * app glue was replaced by props.
 *
 * What lives HERE (presentation + form mechanics):
 *   • the `<AuthCard>` frame whose title/description track the stage (the #1033
 *     `<h1>` a11y landmark; the #227 privacy-masked destination),
 *   • the EARS-11 request form (union identifier box, #196) and the EARS-12
 *     complete form (slotted 6-char alphanumeric code + new password, submitted
 *     together — which is why this surface never adopted `<OtpFocusScreen>`),
 *   • the #267 resend footer: the shared `useResendCountdown` timer restarted by a
 *     `resendNonce` bump, the «start over» control, and the #326 neutral resend
 *     acknowledgement slot,
 *   • the #212/#211 mount discipline — each stage's form lives in a child that
 *     mounts with the stage, so no `code` Controller is ever registered late.
 *
 * What stays in the HOST app (the blocks-tier contract — see `./index.ts`): copy,
 * i18n, the zod resolvers (localized messages + the `@ds/schemas` SSOT), BFF
 * transport, the EARS-16 enumeration-safe outcome mapping, the resend
 * orchestration and its captcha element (passed as slots), routing/redirects and
 * the link component (Next.js `<Link>` via `renderLink`).
 *
 * The STAGE is controlled by the host: it flips to `"complete"` only once the
 * host's protected request actually succeeded — which is what the portal's
 * bot-protection callback signals — exactly as `<LoginCard>`'s `sentIdentifier`
 * does for the login OTP stage.
 */

/** The reset code is a FIXED 6 characters (Zitadel default) — and ALPHANUMERIC
 * (e.g. `PVDC3R`), not digits-only — like the registration verify code. `<OtpField>`
 * uses its slotted variant, which accepts letters (it carries no digit-only filter). */
export const PASSWORD_RECOVERY_OTP_LENGTH = 6;

/**
 * Resend cooldown (#267) for the reset complete step. Bumping the nonce restarts the
 * shared `useResendCountdown` timer (the same one `<OtpFocusScreen>` runs on /login
 * & /verify) without a remount. The reset code-step submits the code TOGETHER with a
 * new password (a shape `<OtpFocusScreen>` doesn't carry), so it reuses the timer +
 * resend orchestration inline rather than adopting the whole block.
 */
export const PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS = 30;

/** The two steps of the recovery flow — EARS-11 initiate / EARS-12 complete. */
export type PasswordRecoveryStage = "request" | "complete";

/** EARS-11 initiate values. */
export interface PasswordRecoveryRequestValues {
  identifier: string;
}

/** EARS-12 complete values — the code and the new password travel together. */
export interface PasswordRecoveryCompleteValues {
  identifier: string;
  code: string;
  newPassword: string;
}

/**
 * Every visible string the block renders, grouped by step. No copy lives in the
 * package (the #235 i18n contract).
 */
export interface PasswordRecoveryCardCopy {
  /** Card title on the request step. */
  title: React.ReactNode;
  /** Card title on the complete step. */
  titleComplete: React.ReactNode;
  descriptionRequest: React.ReactNode;
  /** "We sent a code to {masked}" — the block masks the destination. */
  descriptionComplete: (destination: string) => React.ReactNode;
  backToSignIn: React.ReactNode;
  request: {
    identifierLabel: string;
    identifierPlaceholder: string;
    submit: React.ReactNode;
  };
  complete: {
    codeLabel: string;
    newPasswordLabel: string;
    passwordPolicyHint: string;
    submit: React.ReactNode;
    startOver: React.ReactNode;
    resend: React.ReactNode;
    resendCountdown: (seconds: number) => React.ReactNode;
  };
}

/** EARS-11 initiate wiring. */
export interface PasswordRecoveryRequestProps {
  /** App-owned RHF resolver (localized messages + the #196 union identifier guard). */
  resolver: Resolver<PasswordRecoveryRequestValues>;
  /**
   * Fire-and-forget: the host's protected request flips `stage` to `"complete"` on
   * success (EARS-16 — the ack is identical whether or not the identifier exists).
   */
  onSubmit: (values: PasswordRecoveryRequestValues) => void;
  /** Already-localized error surfaced under the field. */
  error?: React.ReactNode | undefined;
  /** Host-side pending signal (e.g. an in-flight captcha challenge). */
  pending?: boolean | undefined;
  /** The host's bot-protection element (EARS-17), where the page rendered it. */
  captchaSlot?: React.ReactNode | undefined;
}

/** EARS-12 complete wiring. */
export interface PasswordRecoveryCompleteProps {
  /** App-owned RHF resolver (#200 — the portal's message-less field schemas). */
  resolver: Resolver<PasswordRecoveryCompleteValues>;
  /** Awaited by RHF, so it drives `isSubmitting`. Transport + routing are the host's. */
  onSubmit: (values: PasswordRecoveryCompleteValues) => Promise<void> | void;
  /** Already-localized completion error. */
  error?: React.ReactNode | undefined;
  /** Already-localized resend/captcha error (its own slot, in the resend footer). */
  resendError?: React.ReactNode | undefined;
  /** Host-side pending signal for the resend control. */
  resendPending?: boolean | undefined;
  /** Bumped by the host on each SUCCESSFUL resend (#267) — restarts the cooldown. */
  resendNonce: number;
  /** Fire-and-forget: the host's protected resend bumps `resendNonce` on success. */
  onResend: () => void;
  /** «Start over» — the host returns the stage to `"request"` and clears its state. */
  onRestart: () => void;
  /** #326 neutral, enumeration-safe resend acknowledgement (host-composed copy). */
  notice?: React.ReactNode | undefined;
  /** The host's bot-protection element for the resend. */
  captchaSlot?: React.ReactNode | undefined;
}

export interface PasswordRecoveryCardProps {
  copy: PasswordRecoveryCardCopy;
  /** Host-owned stage: `"complete"` only once the request actually succeeded. */
  stage: PasswordRecoveryStage;
  /**
   * The identifier the code was sent to. Seeds the complete form and is MASKED for
   * display; empty on the request step.
   */
  identifier: string;
  /** Target for the footer link back to sign-in. */
  links: { login: string };
  /**
   * Host anchor renderer — the apps pass Next.js `<Link>` so client-side navigation
   * (and prefetch) survives the lift. Defaults to a plain `<a>`.
   */
  renderLink?: (props: {
    href: string;
    children: React.ReactNode;
  }) => React.ReactNode;
  /** Card glyph (app-supplied — the package carries no icon set). */
  icon?: React.ReactNode | undefined;
  request: PasswordRecoveryRequestProps;
  complete: PasswordRecoveryCompleteProps;
  /** Fixed code length; defaults to the 6-char reset code. */
  otpLength?: number;
  /** Resend cooldown in seconds; defaults to 30. */
  resendCooldownSeconds?: number;
}

const defaultRenderLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => <a href={href}>{children}</a>;

export function PasswordRecoveryCard({
  copy,
  stage,
  identifier,
  links,
  renderLink = defaultRenderLink,
  icon,
  request,
  complete,
  otpLength = PASSWORD_RECOVERY_OTP_LENGTH,
  resendCooldownSeconds = PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS,
}: PasswordRecoveryCardProps) {
  return (
    <AuthCard
      icon={icon}
      // Canvas: the title tracks the stage — «Сброс пароля» on the request step,
      // «Новый пароль» once the code + new-password step is showing.
      // #1033: rendered as the document's single h1 (a11y landmark) — a bare h1
      // inherits the CardTitle styling via Tailwind preflight, pixel-identical.
      title={<h1>{stage === "request" ? copy.title : copy.titleComplete}</h1>}
      description={
        stage === "request"
          ? copy.descriptionRequest
          : // #227: confirm WHERE the reset code went with a privacy-masked
            // destination (the same `maskDestination` the login-OTP focus-screen
            // shows), never the full identifier.
            copy.descriptionComplete(maskDestination(identifier))
      }
      footer={
        <DsLink asChild>
          {renderLink({ href: links.login, children: copy.backToSignIn })}
        </DsLink>
      }
    >
      {stage === "request" ? (
        <RecoveryRequestForm copy={copy.request} {...request} />
      ) : (
        <RecoveryCompleteForm
          copy={copy.complete}
          identifier={identifier}
          otpLength={otpLength}
          cooldownSeconds={resendCooldownSeconds}
          {...complete}
        />
      )}
    </AuthCard>
  );
}

/**
 * EARS-11 initiate step. It lives in its own child so returning from the complete
 * step («start over») remounts it with an empty identifier — the behaviour the page
 * produced with an explicit `requestForm.reset({ identifier: "" })`.
 */
function RecoveryRequestForm({
  copy,
  resolver,
  onSubmit,
  error,
  pending = false,
  captchaSlot,
}: PasswordRecoveryRequestProps & {
  copy: PasswordRecoveryCardCopy["request"];
}) {
  // #196: validate the identifier with the union guard (email OR E.164 phone), NOT
  // the loose `PasswordResetRequestSchema` (which stays `identifier:
  // z.string().min(1)` so Zitadel remains the credential authority) — the resolver is
  // app-owned. Before #197 this form used the loose schema, so a bare numeric string
  // sailed through unvalidated. The submitted body still matches the loose contract.
  const form = useForm<PasswordRecoveryRequestValues>({
    // `onTouched` (#200): flag a malformed identifier on blur, before submit.
    mode: "onTouched",
    resolver,
    defaultValues: { identifier: "" },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        {/* #196 fix: the reset identifier is the same union box as login-password —
            `<IdentifierField>` bakes in the email-OR-phone validation, so a bare
            numeric is rejected before submit. UNMASKED (the default), matching the
            login-password box — only the OTP-sms channel masks. */}
        <FormField
          control={form.control}
          name="identifier"
          render={({ field }) => (
            <IdentifierField
              field={field}
              label={copy.identifierLabel}
              placeholder={copy.identifierPlaceholder}
            />
          )}
        />
        {captchaSlot}
        <FormError>{error}</FormError>
        <Button
          type="submit"
          className="w-full"
          loading={form.formState.isSubmitting || pending}
          data-testid="reset-request-submit"
        >
          {copy.submit}
        </Button>
      </form>
    </Form>
  );
}

/**
 * EARS-12 complete step. Its OWN `useForm` lives here so the `code` Controller is
 * registered on this component's first render: the component mounts only once the
 * request step has fired, so there is no late-mounted Controller and no post-hoc
 * `reset()`/`setValue()` seeding of a parent-held form — both of which left the
 * slotted `code` field detached and dropped every keystroke on /reset (#212/#211,
 * the same class of failure /login's OTP verify step was restructured to avoid).
 * `identifier` comes in as a prop (the BFF re-resolves it); the user types the code
 * and the new password and submits both together.
 */
function RecoveryCompleteForm({
  copy,
  identifier,
  otpLength,
  cooldownSeconds,
  resolver,
  onSubmit,
  error,
  resendError,
  resendPending = false,
  resendNonce,
  onResend,
  onRestart,
  notice,
  captchaSlot,
}: PasswordRecoveryCompleteProps & {
  copy: PasswordRecoveryCardCopy["complete"];
  identifier: string;
  otpLength: number;
  cooldownSeconds: number;
}) {
  // #200: the resolver is app-owned so the complete step validates against the
  // portal's message-less field schemas (the request schema's message-carrying
  // `NewPasswordSchema` outranks the localized error map in zod v4 and leaked
  // English onto the field). The submitted body still matches the loose
  // `@ds/schemas` contract; the API enforces the real policy. Seeded with the
  // resolved `identifier` at mount — no post-toggle reset()/setValue().
  const form = useForm<PasswordRecoveryCompleteValues>({
    mode: "onTouched",
    resolver,
    defaultValues: { identifier, code: "", newPassword: "" },
  });

  const remaining = useResendCountdown(cooldownSeconds, resendNonce);
  const resendDisabled = remaining > 0;

  // On a successful resend clear the superseded code (the new password is kept — the
  // user only needs the fresh code). Skips the initial mount.
  const isInitialResend = React.useRef(true);
  React.useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    form.resetField("code");
    // Keyed only on the resend signal — `form` is a stable useForm handle.
  }, [resendNonce]);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          onSubmit({ ...values, identifier }),
        )}
        className="space-y-4"
        noValidate
      >
        {/* Slotted 6-char alphanumeric code (no auto-submit here — the complete step
            pairs the code with a new password, so the user submits both
            together; `onComplete` is intentionally omitted). */}
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <OtpField
              field={field}
              length={otpLength}
              variant="slotted"
              charset="alphanumeric"
              label={copy.codeLabel}
            />
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <PasswordField
              field={field}
              purpose="new"
              label={copy.newPasswordLabel}
              policyHint={copy.passwordPolicyHint}
            />
          )}
        />
        <FormError>{error}</FormError>
        <Button
          type="submit"
          className="w-full"
          loading={form.formState.isSubmitting}
        >
          {copy.submit}
        </Button>
      </form>
      {/* #267: focus-polish footer — separated from the password field with a top
          border + spacing so «Начать заново» is no longer jammed against the input
          (owner finding). «Начать заново» (change the identifier, back to the
          request step) on the left, resend-with-cooldown on the right; mirrors the
          focus-screen's change-method/resend pairing, kept inline because the reset
          step submits the code together with a new password. */}
      <div className="mt-6 space-y-3 border-t pt-4">
        {captchaSlot}
        <FormError>{resendError}</FormError>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRestart}
            data-testid="reset-restart"
            // `shrink-0` — «Начать заново» keeps its size; the resend label is the
            // flex item that yields when the row is cramped (#542).
            className="shrink-0"
          >
            {copy.startOver}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={resendDisabled || resendPending}
            loading={resendPending}
            onClick={onResend}
            data-testid="reset-resend"
            // `tabular-nums` — fixed-width digits so the countdown does not jitter
            // (#227/#267 owner finding). `min-w-0` + `whitespace-normal` override the
            // Button base `whitespace-nowrap` so the cooldown label WRAPS instead of
            // overflowing the card frame at any width (#542 — the owner-reported bug).
            className="min-w-0 whitespace-normal text-right tabular-nums"
          >
            {resendDisabled ? copy.resendCountdown(remaining) : copy.resend}
          </Button>
        </div>
        {/* #326: neutral, enumeration-safe confirmation — NOT destructive (a success
            ack, not an error). Identical copy in every case; the account-exists fact
            is disclosed out-of-band by email, never here. */}
        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
            data-testid="reset-resend-notice"
          >
            {notice}
          </p>
        )}
      </div>
    </Form>
  );
}
