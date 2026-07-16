"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";

import {
  OtpVerifySchema,
  type LoginRequest,
  type OtpChannel,
  type OtpRequest,
  type OtpVerify,
} from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import { BotProtectionField } from "@/components/bot-protection";
import {
  EmailField,
  IdentifierField,
  PasswordField,
  PhoneField,
} from "@ds/design-system/fields";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import {
  LoginIdentifierFormSchema,
  otpIdentifierFormSchema,
} from "@/lib/identifier-validation";
import { withReturnTarget } from "@/lib/registration-handoff";
import { completeReturnTarget } from "@/lib/registration-resume";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import { Link as DsLink } from "@ds/design-system/link";
import {
  AuthCard,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";
import { Form, FormField, FormError } from "@ds/design-system/form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system/tabs";

/*
 * Sign-in surface (#131, rebuilt on the design system in #237). Wires the live BFF
 * (003 F2 password / F3 OTP) into the portal: forms validate with the `@ds/schemas`
 * SSOT (NO re-declared zod), submit same-origin to `/v1/auth/*` via {@link
 * authClient}, and on success the BFF sets the `__Host-ds_session` cookie and we
 * route to the session-aware `/account` landing. No token ever touches this client
 * (EARS-8). Two journeys live here:
 *   • Password login (EARS-5): single `identifier` box (email OR phone) — Zitadel
 *     resolves it — plus password.
 *   • Passwordless OTP login (EARS-6 email / EARS-7 SMS): request a code for an
 *     identifier+channel, then the surface swaps to the focused OTP screen.
 *
 * #237 / #227: once a code is requested the OTP journey renders the design-system
 * `<OtpFocusScreen>` block INSTEAD of the request chrome — masked destination +
 * code box (auto-submit) + resend-with-cooldown + change-method/back, and BY
 * CONSTRUCTION no channel switcher or secondary links, so the user cannot wander off
 * the issued challenge (the #192/#196/#200/#211/#212/#227 papercut class). The whole
 * surface is wrapped in the brand `<AuthShell>` (the approved split-screen look).
 *
 * 005 EARS-2: a guest carried into this flow from an event's «Участвовать» CTA
 * arrives with `?returnTo=/webinars/:slug` (the safe registration-intent, 004
 * EARS-3 → 005 design §3.2). On login success — password or OTP — the carried
 * registration completes (`completeReturnTarget` fires the same EARS-1
 * `RegisterForEvent`, then lands on that event page registered); the
 * create-account link carries the context onward into /register. A hostile
 * returnTo is rejected by the `parseReturnTarget` guard at every consumption
 * point — never navigated to, never propagated. `useSearchParams` requires a
 * Suspense boundary in the App Router, so the card is split out and wrapped.
 */

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </AuthShell>
  );
}

function LoginCard() {
  const t = useTranslations("login");
  // 005 EARS-2: the carried registration-intent (guard-validated at every
  // consumption point; this surface only forwards or completes it).
  const returnTo = useSearchParams().get("returnTo");
  return (
      <AuthCard
        icon={<ShieldCheck className="text-primary" aria-hidden />}
        title={t("title")}
        description={t("description")}
        footer={
          <>
            <DsLink asChild>
              {/* 005 EARS-2: signup is a co-equal auth path — the event context
                  rides onward into /register so it survives this hop too. */}
              <Link href={withReturnTarget("/register", returnTo)}>
                {t("createAccount")}
              </Link>
            </DsLink>
            <DsLink asChild>
              <Link href="/reset">{t("forgotPassword")}</Link>
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
        <Tabs defaultValue="password">
          <TabsList aria-label={t("methodSwitcherLabel")}>
            <TabsTrigger value="password" data-testid="login-method-password">
              {t("methodPassword")}
            </TabsTrigger>
            <TabsTrigger value="otp" data-testid="login-method-otp">
              {t("methodOtp")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="password">
            <PasswordLogin returnTo={returnTo} />
          </TabsContent>
          <TabsContent value="otp">
            <OtpLogin returnTo={returnTo} />
          </TabsContent>
        </Tabs>
      </AuthCard>
  );
}

/** EARS-5 password login. */
function PasswordLogin({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // #192: validate with a portal-side per-channel guard, NOT the loose
  // `LoginRequestSchema` (which stays `identifier: z.string().min(1)` so Zitadel
  // remains the credential authority). The identifier box accepts a valid email
  // OR an E.164 phone — Zitadel resolves whichever — so a bare numeric string
  // like `99545545445` is now rejected before submit. The request body still
  // matches the loose `@ds/schemas` contract.
  const form = useForm<LoginRequest>({
    // `onTouched` (#200): flag a malformed identifier on blur, before submit —
    // applied consistently across every auth form.
    mode: "onTouched",
    resolver: useLocalizedResolver(LoginIdentifierFormSchema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: LoginRequest) {
    setError(null);
    try {
      await authClient.login({
        ...values,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // The BFF set the `__Host-` cookie; the session shell reads it server-side.
      // 005 EARS-2: with a carried event context the session now exists, so the
      // registration completes and the doctor lands back on that event page;
      // without one this is the 008 EARS-7 discovery front-door (`/`) landing.
      router.push(await completeReturnTarget(returnTo));
    } catch (err) {
      // EARS-16: the login OUTCOME (wrong credential / unknown account) stays the
      // generic message so the UI never leaks an existence/error oracle. Only the
      // non-oracle statuses get a specific message: 429 → too-many-attempts,
      // 5xx/network → temporarily-unavailable.
      setError(authErrorMessage(err, te, te("loginFailed")));
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
        aria-label={t("passwordFormLabel")}
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
              label={tc("emailOrPhone")}
              placeholder={tc("identifierPlaceholder")}
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
              label={tc("password")}
            />
          )}
        />
        {/* Bot-protection mechanism (#84); the EARS-17 after-N-failures policy is
            F6/#90, so here it renders unconditionally (harmless — the guard no-ops
            without a configured provider). Its token rides as `captchaToken`. */}
        <BotProtectionField onToken={setCaptchaToken} />
        <FormError>{error}</FormError>
        <Button
          type="submit"
          className="w-full"
          loading={form.formState.isSubmitting}
          data-testid="password-login-submit"
        >
          {t("submit")}
        </Button>
      </form>
    </Form>
  );
}

/**
 * Resend cooldown (#227). The `<OtpFocusScreen>` block restarts its live countdown
 * whenever `resendNonce` is bumped, so a successful resend just increments the nonce
 * (no remount) — see `resendNonce` below.
 */
const RESEND_COOLDOWN_SECONDS = 30;

/** EARS-6/7 passwordless OTP login: request a code, then the focus-screen takes over. */
function OtpLogin({ returnTo }: { returnTo: string | null }) {
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [channel, setChannel] = useState<OtpChannel>("email");
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // #266: a successful resend bumps this nonce, passed to <OtpVerifyForm> →
  // <OtpFocusScreen>, which restarts its `RESEND_COOLDOWN_SECONDS` countdown on the
  // change WITHOUT a remount (the old #237 `key={resendNonce}` remount hack is gone).
  // <OtpVerifyForm> also clears the now-superseded typed code on the same signal.
  const [resendNonce, setResendNonce] = useState(0);

  // #192: the resolver tracks the ACTIVE channel — email channel requires a valid
  // email, SMS channel requires an E.164 phone. Rebuilt per channel so switching
  // re-validates against the right shape. The loose `OtpRequestSchema` is NOT used
  // as the form guard (it stays the BFF contract); the submitted body still matches
  // it.
  const requestResolverSchema = useMemo(
    () => otpIdentifierFormSchema(channel),
    [channel],
  );
  const requestForm = useForm<OtpRequest>({
    mode: "onTouched", // #200: flag a malformed identifier on blur, before submit.
    resolver: useLocalizedResolver(requestResolverSchema),
    defaultValues: { identifier: "", channel: "email" },
  });

  async function sendOtp(value: string) {
    await authClient.requestOtp({
      identifier: value,
      channel,
      ...(captchaToken ? { captchaToken } : {}),
    });
  }

  async function onRequest(values: OtpRequest) {
    setError(null);
    try {
      await sendOtp(values.identifier);
      // Carry the identifier into the focus-screen (the BFF re-resolves it on
      // verify). The verify step is a SEPARATE component (<OtpVerifyForm/>) that
      // mounts only once `sent` flips, so its own useForm registers the `code`
      // field on its first render — no late-mounted/detached Controller (#131/#153).
      setIdentifier(values.identifier);
      setResendNonce(0);
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err, te, te("otpSendFailed")));
    }
  }

  // #227/#266 resend: re-request the SAME identifier+channel code. On success bump the
  // nonce (the focus-screen restarts its cooldown + the verify form clears the stale
  // code, both without a remount); on failure surface the error and leave the screen.
  async function onResend() {
    setError(null);
    try {
      await sendOtp(identifier);
      setResendNonce((n) => n + 1);
    } catch (err) {
      setError(authErrorMessage(err, te, te("otpSendFailed")));
    }
  }

  return (
    <div className="space-y-4" aria-label={t("otpFormLabel")}>
      {!sent ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("otpHeading")}</p>
            <p className="text-xs text-muted-foreground">
              {t("otpDescription")}
            </p>
          </div>

          {/* Channel selector — drives EARS-6 (email) vs EARS-7 (sms). Present only
              on the request step; once a code is sent the focus-screen omits it by
              construction (#227), and "Изменить способ" returns here. */}
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label={t("otpChannelGroupLabel")}
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
                {c === "email" ? t("otpChannelEmail") : t("otpChannelSms")}
              </Button>
            ))}
          </div>

          <Form {...requestForm}>
            <form
              onSubmit={requestForm.handleSubmit(onRequest)}
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
                      label={tc("email")}
                      placeholder={tc("emailPlaceholder")}
                    />
                  ) : (
                    <PhoneField
                      field={field}
                      testId="otp-identifier"
                      label={tc("phone")}
                      placeholder={tc("shortPhonePlaceholder")}
                    />
                  )
                }
              />
              <BotProtectionField onToken={setCaptchaToken} />
              <FormError>{error}</FormError>
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                loading={requestForm.formState.isSubmitting}
                data-testid="otp-send"
              >
                {t("sendCode")}
              </Button>
            </form>
          </Form>
        </>
      ) : (
        <OtpVerifyForm
          identifier={identifier}
          channel={channel}
          returnTo={returnTo}
          error={error}
          cooldownSeconds={RESEND_COOLDOWN_SECONDS}
          resendNonce={resendNonce}
          onResend={onResend}
          onError={setError}
          onBack={() => {
            setSent(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Zitadel's login email/SMS OTP codes are a FIXED 8 digits (verified live on the
 * dev-stand, #153). #175: that fixed length lets the field auto-submit the moment the
 * final digit lands, via the slotted `InputOTP onComplete`. #211 unified the
 * presentation: all three code surfaces (`/login`, `/verify`, `/reset`) use the
 * slotted variant — 8 slots fit the focus screen.
 */
const LOGIN_OTP_LENGTH = 8;

/**
 * EARS-6/7 verify step, rendered through the design-system `<OtpFocusScreen>` (#227).
 * Its OWN `useForm` lives here so the `code` field is registered on this component's
 * first render: it mounts only once a code has been requested, so there is no
 * late-mounted Controller and no post-hoc seeding (both of which left the field
 * detached and dropped every keystroke — #131/#153 live). `identifier`+`channel` come
 * in as props (the BFF re-resolves them); the user only types the code.
 *
 * Error + resend are lifted to the parent <OtpLogin> (which owns the network call
 * and the resend cooldown signal): `error` is shown in the focus-screen's slot,
 * `onResend` re-requests the code, `onError` reports a verify failure upward, and
 * `onBack` ("Изменить способ") returns to channel selection. `resendNonce` is bumped
 * by the parent on a successful resend — it restarts the focus-screen cooldown and
 * clears the now-stale code here, both WITHOUT a remount (#266).
 */
function OtpVerifyForm({
  identifier,
  channel,
  returnTo,
  error,
  cooldownSeconds,
  resendNonce,
  onResend,
  onError,
  onBack,
}: {
  identifier: string;
  channel: OtpChannel;
  /** 005 EARS-2: the carried registration-intent, completed on verify success. */
  returnTo: string | null;
  error: string | null;
  cooldownSeconds: number;
  resendNonce: number;
  onResend: () => void;
  onError: (message: string) => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("login");
  const te = useTranslations("errors");

  const verifyForm = useForm<OtpVerify>({
    mode: "onTouched", // #200: consistent on-blur validation across the auth forms.
    resolver: useLocalizedResolver(OtpVerifySchema),
    defaultValues: { identifier, code: "", channel },
  });

  // #266: on a resend (nonce bump) clear the now-superseded typed code — the
  // behaviour the old `key={resendNonce}` remount gave incidentally, now explicit so
  // the block no longer has to be remounted to reset. Skips the initial mount (the
  // field already defaults to ""); `resetField` is keyed only on the nonce.
  const isInitialResend = useRef(true);
  useEffect(() => {
    if (isInitialResend.current) {
      isInitialResend.current = false;
      return;
    }
    verifyForm.resetField("code");
    // Keyed only on the resend signal — `verifyForm` is a stable useForm handle.
  }, [resendNonce]);

  async function onVerify(values: OtpVerify) {
    try {
      await authClient.loginWithOtp({ ...values, identifier, channel });
      // 005 EARS-2: complete the carried registration (if any) now the session
      // exists, landing on the event page — else the 008 EARS-7 front-door (`/`).
      router.push(await completeReturnTarget(returnTo));
    } catch (err) {
      onError(authErrorMessage(err, te, te("otpVerifyFailed")));
    }
  }

  // #175: auto-submit once the fixed-length login OTP is fully entered. The in-flight
  // guard (`isSubmitting`) prevents a double network call if completion races a manual
  // click / the Enter key, and stops a re-fire if a later keystroke/paste keeps the
  // value at full length.
  const submit = verifyForm.handleSubmit(onVerify);
  const onCodeComplete = useCallback(() => {
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
            length={LOGIN_OTP_LENGTH}
            variant="slotted"
            title={t("otpVerifyTitle")}
            sentToLabel={t("otpSentTo", {
              destination: maskDestination(identifier),
            })}
            codeLabel={t("enterCode")}
            submitLabel={t("verifyAndSignIn")}
            resendLabel={t("resend")}
            resendCountdownLabel={(seconds) => t("resendIn", { seconds })}
            changeMethodLabel={t("changeMethod")}
            cooldownSeconds={cooldownSeconds}
            resendNonce={resendNonce}
            isSubmitting={verifyForm.formState.isSubmitting}
            onComplete={onCodeComplete}
            onSubmit={submit}
            onResend={onResend}
            onChangeMethod={onBack}
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
