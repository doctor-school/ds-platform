"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Button } from "../primitives/button";
import { Link as DsLink } from "../primitives/link";
import { Form, FormField, FormError } from "../primitives/form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../primitives/tabs";
import {
  EmailField,
  IdentifierField,
  PasswordField,
  PhoneField,
} from "../primitives/fields";
import { AuthCard } from "./auth-card";
import { OtpFocusScreen } from "./otp-focus-screen";
import { maskDestination } from "./mask-destination";

/**
 * `<LoginCard>` (#1666 slice A) — the ONE canonical sign-in composition both
 * storefronts mount (AGENTS.md §6 «Cross-front capability reuse before invention»,
 * ADR-0013 A1). It was lifted VERBATIM out of `apps/portal/app/login/page.tsx`
 * (#131 → #237 → #227 → #266): same elements, order, classes, `data-testid`s and
 * state presentation — only the app glue was replaced by props.
 *
 * What lives HERE (presentation + form mechanics):
 *   • the `<AuthCard>` frame with the `<h1>` title (the #1033 a11y landmark),
 *   • the #179 method `Tabs` (Radix unmounts the inactive `TabsContent`, so only
 *     the active method's fields exist in the DOM),
 *   • the EARS-5 password form and the EARS-6/7 OTP request form — each with its
 *     own RHF handle, `onTouched` validation (#200) and `Button.loading` pending
 *     affordance (#337),
 *   • the #227 focus-screen stage on `<OtpFocusScreen>`, including the #266
 *     no-remount resend mechanic (a `resendNonce` bump restarts the cooldown and
 *     clears the superseded code without a `key` remount).
 *
 * What stays in the HOST app (the blocks-tier contract — see `./index.ts`): copy,
 * i18n, the zod resolvers (they carry the app's localized messages and the
 * `@ds/schemas` SSOT), BFF transport, EARS-16 outcome mapping, routing/redirects,
 * the captcha element (passed as a slot) and the link component (Next.js
 * `<Link>` via `renderLink`, so client-side navigation is preserved).
 *
 * The OTP stage is CONTROLLED by the host: `otp.sentIdentifier` flips to non-null
 * only once the host's protected request actually succeeded, which is what the
 * portal's bot-protection callback signals. The channel selection, in contrast, is
 * block state — it drives which field primitive renders and is handed back on every
 * OTP handler call.
 */

/** Resend cooldown (#227): the focus-screen restarts it on every `resendNonce` bump. */
export const LOGIN_RESEND_COOLDOWN_SECONDS = 30;

/**
 * Zitadel's login email/SMS OTP codes are a FIXED 8 digits (verified live on the
 * dev-stand, #153) — that fixed length is what lets the field auto-submit on the
 * final digit (#175), in the #211 unified slotted presentation.
 */
export const LOGIN_OTP_LENGTH = 8;

/** The two sign-in methods the tab switcher offers. */
export type LoginCardMethod = "password" | "otp";

/** The two passwordless channels — EARS-6 (email) / EARS-7 (sms). */
export type LoginCardOtpChannel = "email" | "sms";

/** EARS-5 password-login form values. */
export interface LoginCardPasswordValues {
  identifier: string;
  password: string;
}

/** EARS-6/7 code-request form values. */
export interface LoginCardOtpRequestValues {
  identifier: string;
  channel: LoginCardOtpChannel;
}

/** EARS-6/7 code-verification form values. */
export interface LoginCardOtpVerifyValues {
  identifier: string;
  code: string;
  channel: LoginCardOtpChannel;
}

/**
 * Every visible string the block renders — one entry per call site, grouped by
 * sub-form. No copy lives in the package (the #235 i18n contract).
 */
export interface LoginCardCopy {
  title: React.ReactNode;
  description: React.ReactNode;
  createAccount: React.ReactNode;
  forgotPassword: React.ReactNode;
  methodSwitcherLabel: string;
  methodPassword: React.ReactNode;
  methodOtp: React.ReactNode;
  password: {
    formLabel: string;
    identifierLabel: string;
    identifierPlaceholder: string;
    passwordLabel: string;
    submit: React.ReactNode;
  };
  otp: {
    formLabel: string;
    heading: React.ReactNode;
    description: React.ReactNode;
    channelGroupLabel: string;
    channelEmail: React.ReactNode;
    channelSms: React.ReactNode;
    emailLabel: string;
    emailPlaceholder: string;
    phoneLabel: string;
    phonePlaceholder: string;
    sendCode: React.ReactNode;
    verifyTitle: React.ReactNode;
    /** Past-tense "code sent to {masked}" — the block masks the destination. */
    sentTo: (destination: string) => React.ReactNode;
    codeLabel: string;
    verifySubmit: React.ReactNode;
    resend: React.ReactNode;
    resendCountdown: (seconds: number) => React.ReactNode;
    changeMethod: React.ReactNode;
  };
}

/** EARS-5 password-login wiring. */
export interface LoginCardPasswordProps {
  /** App-owned RHF resolver (localized messages + the app's identifier guard). */
  resolver: Resolver<LoginCardPasswordValues>;
  /** Awaited by RHF, so it drives `isSubmitting`. Transport + EARS-16 mapping are the host's. */
  onSubmit: (values: LoginCardPasswordValues) => Promise<void> | void;
  /** Already-localized error surfaced under the fields. */
  error?: React.ReactNode;
  /** Host-side pending signal (e.g. an in-flight captcha challenge). */
  pending?: boolean;
  /** The host's bot-protection element, rendered where the page rendered it. */
  captchaSlot?: React.ReactNode;
}

/** EARS-6/7 passwordless-OTP wiring. */
export interface LoginCardOtpProps {
  /** Per-channel request resolvers — the guard differs (email vs E.164 phone, #192). */
  requestResolvers: Record<
    LoginCardOtpChannel,
    Resolver<LoginCardOtpRequestValues>
  >;
  /** Verify-step resolver. */
  verifyResolver: Resolver<LoginCardOtpVerifyValues>;
  /**
   * Non-null once the host confirms a code was issued for it → the focus screen
   * takes over. `null` returns to the request chrome.
   */
  sentIdentifier: string | null;
  /** Bumped by the host on each SUCCESSFUL resend (#266) — restarts the cooldown. */
  resendNonce: number;
  /** Already-localized error on the request step. */
  error?: React.ReactNode;
  /** Already-localized error on the focus screen (action + verify failures). */
  screenError?: React.ReactNode;
  /** Host-side pending signal for the request submit. */
  pending?: boolean;
  /** The host's bot-protection element — mounted across BOTH stages, as on the page. */
  captchaSlot?: React.ReactNode;
  /** Fire-and-forget: the host's protected send flips `sentIdentifier` on success. */
  onRequest: (values: LoginCardOtpRequestValues) => void;
  /** Fire-and-forget: the host's protected resend bumps `resendNonce` on success. */
  onResend: (values: LoginCardOtpRequestValues) => void;
  /** Awaited by RHF, so it drives the focus-screen pending affordance. */
  onVerify: (values: LoginCardOtpVerifyValues) => Promise<void> | void;
  /** "Change method" — the host clears `sentIdentifier` and its error state. */
  onChangeMethod: () => void;
}

export interface LoginCardProps {
  copy: LoginCardCopy;
  /** Targets for the two footer links; the host renders them via `renderLink`. */
  links: { register: string; reset: string };
  /**
   * Host anchor renderer — the apps pass Next.js `<Link>` so client-side
   * navigation (and prefetch) survives the lift. Defaults to a plain `<a>`.
   */
  renderLink?: (props: {
    href: string;
    children: React.ReactNode;
  }) => React.ReactNode;
  /** Card glyph (app-supplied — the package carries no icon set). */
  icon?: React.ReactNode;
  password: LoginCardPasswordProps;
  otp: LoginCardOtpProps;
  /**
   * Fired when the method tab changes. Radix unmounts the inactive `TabsContent`,
   * so the block's own per-method state (form values, channel) resets by
   * construction — this is the signal for the host to reset the state IT holds
   * (errors, pending, the OTP stage), reproducing exactly what the page's
   * unmount-per-tab structure did before the lift.
   */
  onMethodChange?: (method: LoginCardMethod) => void;
  /**
   * Initially selected method tab. Defaults to `"password"` (#179: no
   * "last-used" persistence). Uncontrolled — exists so a catalogue/showcase host
   * can present the code-entry stage; the apps leave it at the default.
   *
   * WARNING: a product host must NOT wire this to a persisted "last used
   * method" — #179 deliberately keeps no auth UI state across visits.
   */
  defaultMethod?: LoginCardMethod;
  /** Fixed OTP length; defaults to the 8-digit login code. */
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

export function LoginCard({
  copy,
  links,
  renderLink = defaultRenderLink,
  icon,
  password,
  otp,
  onMethodChange,
  defaultMethod = "password",
  otpLength = LOGIN_OTP_LENGTH,
  resendCooldownSeconds = LOGIN_RESEND_COOLDOWN_SECONDS,
}: LoginCardProps) {
  return (
    <AuthCard
      icon={icon}
      // #1033: the page title is the document's single h1 (a11y landmark).
      // Bare h1 — Tailwind preflight makes it inherit the CardTitle styling,
      // so the render is pixel-identical.
      title={<h1>{copy.title}</h1>}
      description={copy.description}
      footer={
        <>
          <DsLink asChild>
            {/* 005 EARS-2: signup is a co-equal auth path — the event context
                  rides onward into /register so it survives this hop too. */}
            {renderLink({ href: links.register, children: copy.createAccount })}
          </DsLink>
          <DsLink asChild>
            {renderLink({ href: links.reset, children: copy.forgotPassword })}
          </DsLink>
        </>
      }
    >
      {/* #179: pick a sign-in method first (segmented control) and render
            ONLY that method's fields — Radix Tabs unmounts the inactive
            `TabsContent`, so the password fields are absent from the DOM while
            the OTP tab is active and vice-versa. Defaults to Password (no
            "last-used" persistence — not persisting auth UI state matches the
            security posture). */}
      <Tabs
        defaultValue={defaultMethod}
        onValueChange={(value) => onMethodChange?.(value as LoginCardMethod)}
      >
        <TabsList aria-label={copy.methodSwitcherLabel}>
          <TabsTrigger value="password" data-testid="login-method-password">
            {copy.methodPassword}
          </TabsTrigger>
          <TabsTrigger value="otp" data-testid="login-method-otp">
            {copy.methodOtp}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <PasswordLogin copy={copy.password} {...password} />
        </TabsContent>
        <TabsContent value="otp">
          <OtpLogin
            copy={copy.otp}
            otpLength={otpLength}
            resendCooldownSeconds={resendCooldownSeconds}
            {...otp}
          />
        </TabsContent>
      </Tabs>
    </AuthCard>
  );
}

/** EARS-5 password login. */
function PasswordLogin({
  copy,
  resolver,
  onSubmit,
  error,
  pending = false,
  captchaSlot,
}: LoginCardPasswordProps & { copy: LoginCardCopy["password"] }) {
  // #192: the resolver is app-owned and validates with a per-channel guard, NOT the
  // loose `LoginRequestSchema` (which stays `identifier: z.string().min(1)` so Zitadel
  // remains the credential authority). The identifier box accepts a valid email OR an
  // E.164 phone — Zitadel resolves whichever — so a bare numeric string like
  // `99545545445` is rejected before submit. The request body still matches the loose
  // contract.
  const form = useForm<LoginCardPasswordValues>({
    // `onTouched` (#200): flag a malformed identifier on blur, before submit —
    // applied consistently across every auth form.
    mode: "onTouched",
    resolver,
    defaultValues: { identifier: "", password: "" },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
        aria-label={copy.formLabel}
        data-testid="password-login-form"
      >
        {/* Union identifier box (email OR E.164 phone — Zitadel resolves it).
            UNMASKED, preserving the prior behavior (#192): only the OTP-sms channel
            masks. `<IdentifierField>` bakes in the union validation so a bare
            numeric string is rejected before submit. */}
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <PasswordField
              field={field}
              purpose="current"
              label={copy.passwordLabel}
            />
          )}
        />
        {captchaSlot}
        <FormError>{error}</FormError>
        <Button
          type="submit"
          className="w-full"
          loading={form.formState.isSubmitting || pending}
          data-testid="password-login-submit"
        >
          {copy.submit}
        </Button>
      </form>
    </Form>
  );
}

/** EARS-6/7 passwordless OTP login: request a code, then the focus-screen takes over. */
function OtpLogin({
  copy,
  otpLength,
  resendCooldownSeconds,
  requestResolvers,
  verifyResolver,
  sentIdentifier,
  resendNonce,
  error,
  screenError,
  pending = false,
  captchaSlot,
  onRequest,
  onResend,
  onVerify,
  onChangeMethod,
}: LoginCardOtpProps & {
  copy: LoginCardCopy["otp"];
  otpLength: number;
  resendCooldownSeconds: number;
}) {
  const [channel, setChannel] = React.useState<LoginCardOtpChannel>("email");

  // #192: the resolver tracks the ACTIVE channel — email channel requires a valid
  // email, SMS channel requires an E.164 phone, so switching re-validates against the
  // right shape. The loose `OtpRequestSchema` is NOT used as the form guard (it stays
  // the BFF contract); the submitted body still matches it.
  const requestForm = useForm<LoginCardOtpRequestValues>({
    mode: "onTouched", // #200: flag a malformed identifier on blur, before submit.
    resolver: requestResolvers[channel],
    defaultValues: { identifier: "", channel: "email" },
  });

  return (
    <div className="space-y-4" aria-label={copy.formLabel}>
      {captchaSlot}
      {sentIdentifier === null ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">{copy.heading}</p>
            <p className="text-xs text-muted-foreground">{copy.description}</p>
          </div>

          {/* Channel selector — drives EARS-6 (email) vs EARS-7 (sms). Present only
              on the request step; once a code is sent the focus-screen omits it by
              construction (#227), and "change method" returns here. */}
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label={copy.channelGroupLabel}
          >
            {(["email", "sms"] as const).map((c) => (
              <Button
                key={c}
                type="button"
                variant={channel === c ? "default" : "outline"}
                size="sm"
                // Canvas `chBtn`: the two channels split the row into equal halves.
                className="flex-1"
                role="radio"
                aria-checked={channel === c}
                data-testid={`otp-channel-${c}`}
                onClick={() => {
                  setChannel(c);
                  // Clear the identifier on channel switch so a value typed for the
                  // previous channel (e.g. an email left in the box) does not linger
                  // into the other channel's stricter shape (#192).
                  requestForm.reset({ identifier: "", channel: c });
                }}
              >
                {c === "email" ? copy.channelEmail : copy.channelSms}
              </Button>
            ))}
          </div>

          <Form {...requestForm}>
            <form
              // `values.channel` — not the `channel` state — so the submitted
              // channel is the one the resolver just validated the identifier
              // against; the two are kept in step by the `reset` on switch above.
              onSubmit={requestForm.handleSubmit((values) => onRequest(values))}
              className="space-y-4"
              noValidate
            >
              {/* The OTP request box is channel-specific: the email channel is a pure
                  email, the sms channel a pure (masked) phone — so it uses the
                  channel-appropriate primitive, not the union box. Both keep the
                  `otp-identifier` test id the e2e queries (via the primitive `testId`
                  prop) and the masked-vs-unmasked behavior (#192). */}
              <FormField
                control={requestForm.control}
                name="identifier"
                render={({ field }) =>
                  channel === "email" ? (
                    <EmailField
                      field={field}
                      testId="otp-identifier"
                      label={copy.emailLabel}
                      placeholder={copy.emailPlaceholder}
                    />
                  ) : (
                    <PhoneField
                      field={field}
                      testId="otp-identifier"
                      label={copy.phoneLabel}
                      placeholder={copy.phonePlaceholder}
                    />
                  )
                }
              />
              <FormError>{error}</FormError>
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                loading={requestForm.formState.isSubmitting || pending}
                data-testid="otp-send"
              >
                {copy.sendCode}
              </Button>
            </form>
          </Form>
        </>
      ) : (
        <OtpVerifyForm
          copy={copy}
          otpLength={otpLength}
          identifier={sentIdentifier}
          channel={channel}
          resolver={verifyResolver}
          error={screenError}
          cooldownSeconds={resendCooldownSeconds}
          resendNonce={resendNonce}
          onVerify={onVerify}
          onResend={() => onResend({ identifier: sentIdentifier, channel })}
          onChangeMethod={onChangeMethod}
        />
      )}
    </div>
  );
}

/**
 * EARS-6/7 verify step, rendered through `<OtpFocusScreen>` (#227). Its OWN
 * `useForm` lives here so the `code` field is registered on this component's first
 * render: it mounts only once a code has been requested, so there is no
 * late-mounted Controller and no post-hoc seeding (both of which left the field
 * detached and dropped every keystroke — #131/#153 live). `identifier`+`channel`
 * come in as props (the BFF re-resolves them); the user only types the code.
 *
 * `resendNonce` is bumped by the host on a successful resend — it restarts the
 * focus-screen cooldown and clears the now-stale code here, both WITHOUT a
 * remount (#266).
 */
function OtpVerifyForm({
  copy,
  otpLength,
  identifier,
  channel,
  resolver,
  error,
  cooldownSeconds,
  resendNonce,
  onVerify,
  onResend,
  onChangeMethod,
}: {
  copy: LoginCardCopy["otp"];
  otpLength: number;
  identifier: string;
  channel: LoginCardOtpChannel;
  resolver: Resolver<LoginCardOtpVerifyValues>;
  error?: React.ReactNode;
  cooldownSeconds: number;
  resendNonce: number;
  onVerify: (values: LoginCardOtpVerifyValues) => Promise<void> | void;
  onResend: () => void;
  onChangeMethod: () => void;
}) {
  const verifyForm = useForm<LoginCardOtpVerifyValues>({
    mode: "onTouched", // #200: consistent on-blur validation across the auth forms.
    resolver,
    defaultValues: { identifier, code: "", channel },
  });

  // #266: on a resend (nonce bump) clear the now-superseded typed code — the
  // behaviour the old `key={resendNonce}` remount gave incidentally, now explicit so
  // the block no longer has to be remounted to reset. Skips the initial mount (the
  // field already defaults to ""); `resetField` is keyed only on the nonce.
  const isInitialResend = React.useRef(true);
  React.useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    verifyForm.resetField("code");
    // Keyed only on the resend signal — `verifyForm` is a stable useForm handle.
  }, [resendNonce]);

  // #175: auto-submit once the fixed-length login OTP is fully entered. The in-flight
  // guard (`isSubmitting`) prevents a double network call if completion races a manual
  // click / the Enter key, and stops a re-fire if a later keystroke/paste keeps the
  // value at full length.
  const submit = verifyForm.handleSubmit((values) =>
    onVerify({ ...values, identifier, channel }),
  );
  const onCodeComplete = React.useCallback(() => {
    if (verifyForm.formState.isSubmitting) return;
    void submit();
  }, [verifyForm.formState.isSubmitting, submit]);

  return (
    <Form {...verifyForm}>
      <FormField
        control={verifyForm.control}
        name="code"
        render={({ field }) => (
          <OtpFocusScreen
            field={field}
            length={otpLength}
            variant="slotted"
            charset="numeric"
            title={copy.verifyTitle}
            sentToLabel={copy.sentTo(maskDestination(identifier))}
            codeLabel={copy.codeLabel}
            submitLabel={copy.verifySubmit}
            resendLabel={copy.resend}
            resendCountdownLabel={copy.resendCountdown}
            changeMethodLabel={copy.changeMethod}
            cooldownSeconds={cooldownSeconds}
            resendNonce={resendNonce}
            isSubmitting={verifyForm.formState.isSubmitting}
            onComplete={onCodeComplete}
            onSubmit={submit}
            onResend={onResend}
            onChangeMethod={onChangeMethod}
            error={error}
            submitTestId="otp-verify"
            resendTestId="otp-resend"
            changeMethodTestId="otp-change-method"
          />
        )}
      />
    </Form>
  );
}
