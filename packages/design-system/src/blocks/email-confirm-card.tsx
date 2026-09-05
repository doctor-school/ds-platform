"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Alert } from "../primitives/alert";
import { Button } from "../primitives/button";
import { Form, FormField, FormError } from "../primitives/form";
import { OtpField } from "../primitives/fields";
import { AuthCard } from "./auth-card";
import { useResendCountdown } from "./use-resend-countdown";

/**
 * `<EmailConfirmCard>` (#1666 slice B) — the ONE canonical post-registration
 * email-confirmation composition both storefronts mount (AGENTS.md §6 «Cross-front
 * capability reuse before invention», ADR-0013 A1). Lifted VERBATIM out of
 * `apps/portal/app/verify/page.tsx` (#131 → #175 → #207 → #267 → #326 → #904):
 * same elements, order, classes, `data-testid`s and state presentation — only the
 * app glue was replaced by props.
 *
 * The surface is EXISTENCE-AGNOSTIC by construction (EARS-16): the BFF returns an
 * identical `pending_verification` for a brand-new and an already-registered
 * address, so the block renders two CO-EQUAL affordances and never branches on
 * account existence — (a) enter the emailed code, (b) sign in / reset password for
 * the owner who is already registered. The per-case routing happens in the inbox or
 * by the user's own choice, never by this form disclosing anything.
 *
 * What lives HERE (presentation + form mechanics):
 *   • the `<AuthCard>` frame with the #1035 `<h1>` landmark and the masked
 *     destination in the description,
 *   • the EARS-3 code form: slotted 6-char alphanumeric `<OtpField>` with the #175
 *     auto-submit + in-flight guard, the `Alert` success row and the error slot,
 *   • the #267 resend control on the shared `useResendCountdown` timer (restarted by
 *     a `resendNonce` bump, clearing the now-stale code without a remount) and the
 *     #326 neutral acknowledgement slot,
 *   • the already-registered section with its two co-equal actions.
 *
 * What stays in the HOST app (the blocks-tier contract — see `./index.ts`): copy,
 * i18n, the zod resolver, BFF transport (including the EARS-25 dedicated resend
 * endpoint), the #904 fragment-derived identifier and its masking/fallback label,
 * the auto-login replay, routing, and the bot-protection element (a slot).
 */

/** The registration verification code is a FIXED 6 characters (Zitadel default) —
 * and ALPHANUMERIC (the email code is not digits-only). `<OtpField>` uses its slotted
 * variant, which accepts letters (no digit-only filter); #211 also moved the 8-char
 * login OTP onto the same slotted look. */
export const EMAIL_CONFIRM_OTP_LENGTH = 6;

/**
 * Resend cooldown (#227/#267). Bumping the nonce restarts the live countdown (the
 * same `useResendCountdown` timer the `<OtpFocusScreen>` block uses) without a
 * remount, and clears the now-stale typed code — matching the proven `/login` pattern.
 */
export const EMAIL_CONFIRM_RESEND_COOLDOWN_SECONDS = 30;

/** EARS-3 verification values — the address is carried, only the code is typed. */
export interface EmailConfirmValues {
  email: string;
  code: string;
}

/**
 * Every visible string the block renders. No copy lives in the package (the #235
 * i18n contract); the masked destination is host-derived and interpolated here.
 */
export interface EmailConfirmCardCopy {
  title: React.ReactNode;
  /** Rich description — the host may embed markup around the destination. */
  description: (destination: string) => React.ReactNode;
  newAccountHeading: string;
  codeLabel: string;
  submit: React.ReactNode;
  /** Success row shown once the server accepted the code. */
  codeAccepted: React.ReactNode;
  resend: React.ReactNode;
  resendCountdown: (seconds: number) => React.ReactNode;
  existingAccountHeading: string;
  existingAccountHint: React.ReactNode;
  goToSignIn: React.ReactNode;
  goToReset: React.ReactNode;
}

/** #267/EARS-25 resend wiring — omitted entirely when there is nothing to resend to. */
export interface EmailConfirmResendProps {
  /** Bumped by the host on each SUCCESSFUL resend — restarts the cooldown. */
  nonce: number;
  /** Fire-and-forget: the host's protected resend bumps `nonce` on success. */
  onResend: () => void;
  /** Already-localized resend/captcha error. */
  error?: React.ReactNode | undefined;
  /** Host-side pending signal (an in-flight captcha challenge). */
  pending?: boolean | undefined;
  /** #326 neutral, enumeration-safe acknowledgement (host-composed copy). */
  notice?: React.ReactNode | undefined;
  /** The host's bot-protection element, where the page rendered it. */
  captchaSlot?: React.ReactNode | undefined;
}

export interface EmailConfirmCardProps {
  copy: EmailConfirmCardCopy;
  /**
   * The address the code was sent to — seeds the non-rendered `email` field the
   * request carries. `undefined` on a bare deep-link (#904).
   */
  email?: string | undefined;
  /** The already-masked destination label the description interpolates. */
  destination: string;
  /** App-owned RHF resolver (localized messages + the `@ds/schemas` SSOT). */
  resolver: Resolver<EmailConfirmValues>;
  /** Awaited by RHF, so it drives `isSubmitting`. Transport + routing are the host's. */
  onSubmit: (values: EmailConfirmValues) => Promise<void> | void;
  /**
   * A submit blocked by validation (#904): the host decides the message, since only
   * it knows whether the identifier is missing or the code is bad.
   */
  onInvalid?: (() => void) | undefined;
  /** Already-localized verification error. */
  error?: React.ReactNode | undefined;
  /** Server-confirmed acceptance — never set optimistically. */
  succeeded?: boolean | undefined;
  /** Targets for the already-registered owner's two co-equal actions. */
  links: { login: string; reset: string };
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
  /** Omit to hide the resend control (nothing to resend to — a bare deep-link). */
  resend?: EmailConfirmResendProps | undefined;
  /** Fixed code length; defaults to the 6-char registration code. */
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

export function EmailConfirmCard({
  copy,
  email,
  destination,
  resolver,
  onSubmit,
  onInvalid,
  error,
  succeeded = false,
  links,
  renderLink = defaultRenderLink,
  icon,
  resend,
  otpLength = EMAIL_CONFIRM_OTP_LENGTH,
  resendCooldownSeconds = EMAIL_CONFIRM_RESEND_COOLDOWN_SECONDS,
}: EmailConfirmCardProps) {
  const form = useForm<EmailConfirmValues>({
    resolver,
    // Seed the address from the host (registration is email-only, #202); the field
    // is not user-editable here — they only type the code. On a cold email-button
    // open the address arrives from the URL fragment after mount (#904), so it is
    // also seeded reactively below once resolved.
    // Spread-if-present rather than `email: undefined`: with
    // `exactOptionalPropertyTypes` an explicit `undefined` is not assignable to the
    // `string` field. RHF reads both as "no default", so the render is unchanged.
    defaultValues: { ...(email === undefined ? {} : { email }), code: "" },
  });

  // #904: the fragment-seeded address resolves after mount (the hash is client-only),
  // so push it into the non-rendered `email` field once known — otherwise the cold
  // open submits with an empty identifier and the code never reaches the api.
  React.useEffect(() => {
    if (email) form.setValue("email", email);
    // Keyed only on the resolved address — `form` is a stable useForm handle.
  }, [email]);

  // On a successful resend (nonce bump) clear the now-superseded typed code, so the
  // user re-enters the fresh code — same explicit reset /login's verify step uses.
  const resendNonce = resend?.nonce ?? 0;
  const isInitialResend = React.useRef(true);
  React.useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    form.resetField("code");
    // Keyed only on the resend signal — `form` is a stable useForm handle.
  }, [resendNonce]);

  // Auto-submit when the fixed-length OTP completes. Guard against a double
  // network call if `onComplete` and a manual button click race, or if
  // `onComplete` re-fires: skip while a submit is already in flight.
  const submit = form.handleSubmit(onSubmit, onInvalid);
  const onComplete = React.useCallback(() => {
    if (form.formState.isSubmitting) return;
    void submit();
  }, [form.formState.isSubmitting, submit]);

  return (
    <AuthCard
      icon={icon}
      // #1035: the page title is the document's single h1 (a11y landmark) — same
      // root cause + fix as #1033/#1034 on /login /register /reset. Bare h1 —
      // Tailwind preflight makes it inherit the CardTitle styling, so the render is
      // pixel-identical.
      title={<h1>{copy.title}</h1>}
      description={copy.description(destination)}
      contentClassName="space-y-6"
    >
      {/* (a) New-registrant path — enter the email code (unchanged auto-submit
            + post-verify auto-login). A co-equal affordance, not the only one. */}
      <section className="space-y-3" aria-label={copy.newAccountHeading}>
        <h2 className="text-eyebrow font-extrabold uppercase tracking-micro text-muted-foreground">
          {copy.newAccountHeading}
        </h2>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-4" noValidate>
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
                  onComplete={onComplete}
                />
              )}
            />
            {/* Canvas success row: confirms acceptance while the host's auto-login
                  replay completes. Adopts the DS `Alert` success variant (✓ +
                  success-tint frame, role=status) — no bespoke callout. */}
            {succeeded ? (
              <Alert variant="success" data-testid="verify-succeeded">
                {copy.codeAccepted}
              </Alert>
            ) : null}
            <FormError>{error}</FormError>
            <Button
              type="submit"
              className="w-full"
              loading={form.formState.isSubmitting}
              data-testid="verify-submit"
            >
              {copy.submit}
            </Button>
          </form>
        </Form>
        {/* #267 resend-with-cooldown, wired by the host to the real EARS-25
              endpoint. Only meaningful when a destination is known; on a bare
              deep-link there is nothing to resend to, so the host omits the whole
              `resend` group and the control is hidden rather than firing an empty
              request. The countdown reuses the SAME timer the focus-screen block
              runs. */}
        {resend ? (
          <EmailConfirmResend
            copy={copy}
            cooldownSeconds={resendCooldownSeconds}
            {...resend}
          />
        ) : null}
      </section>

      {/* (b) Already-registered owner's path — prominent, co-equal sign-in /
            reset actions (NOT a footnote link). The screen never branches on
            account existence; the owner's path is also reinforced out-of-band by
            the EARS-23 notice email. */}
      <section
        className="space-y-3 border-t pt-6"
        aria-label={copy.existingAccountHeading}
      >
        <h2 className="text-eyebrow font-extrabold uppercase tracking-micro text-muted-foreground">
          {copy.existingAccountHeading}
        </h2>
        <p className="text-sm text-muted-foreground">
          {copy.existingAccountHint}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            asChild
            variant="default"
            className="flex-1"
            data-testid="verify-go-to-login"
          >
            {renderLink({ href: links.login, children: copy.goToSignIn })}
          </Button>
          <Button
            asChild
            variant="outline"
            className="flex-1"
            data-testid="verify-go-to-reset"
          >
            {renderLink({ href: links.reset, children: copy.goToReset })}
          </Button>
        </div>
      </section>
    </AuthCard>
  );
}

/** The #267 resend row: shared cooldown timer, captcha slot, error and #326 ack. */
function EmailConfirmResend({
  copy,
  cooldownSeconds,
  nonce,
  onResend,
  error,
  pending = false,
  notice,
  captchaSlot,
}: EmailConfirmResendProps & {
  copy: EmailConfirmCardCopy;
  cooldownSeconds: number;
}) {
  const remaining = useResendCountdown(cooldownSeconds, nonce);
  const resendDisabled = remaining > 0;

  return (
    <div className="space-y-2">
      {captchaSlot}
      <FormError>{error}</FormError>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={resendDisabled || pending}
          loading={pending}
          onClick={onResend}
          data-testid="verify-resend"
          // `tabular-nums` — fixed-width digits so the countdown label does not
          // jitter as the seconds tick down (#227/#267 owner finding). `min-w-0` +
          // `whitespace-normal` override the Button base `whitespace-nowrap` so the
          // label wraps instead of overflowing the card at any width (#542).
          className="min-w-0 whitespace-normal text-right tabular-nums"
        >
          {resendDisabled ? copy.resendCountdown(remaining) : copy.resend}
        </Button>
      </div>
      {/* #326: neutral, enumeration-safe confirmation — NOT destructive (it is a
            success ack, not an error). Identical copy in every case; the
            account-exists fact is disclosed out-of-band by email, never here. */}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
          data-testid="verify-resend-notice"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
