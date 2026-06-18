"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

import { BotProtectionField } from "@/components/bot-protection";
import { AuthShell } from "@/components/auth-shell";
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
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import { Form, FormField } from "@ds/design-system/form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system/tabs";
import {
  AuthCard,
  OtpFocusScreen,
  maskDestination,
} from "@ds/design-system/blocks";

/*
 * Sign-in surface (#131, rebuilt on `@ds/design-system` for #237). Wires the live
 * BFF (003 F2 password / F3 OTP) into the portal: forms validate with the
 * `@ds/schemas` SSOT (NO re-declared zod), submit same-origin to `/v1/auth/*` via
 * {@link authClient}, and on success the BFF sets the `__Host-ds_session` cookie and
 * we route to the session-aware `/account` landing. No token ever touches this
 * client (EARS-8). Presentation is now the branded `<AuthShell>` split-screen +
 * `<AuthCard>`; the passwordless verify step is the reusable `<OtpFocusScreen>`
 * (masked destination + resend/cooldown + auto-submit — #227). Two journeys:
 *   • Password login (EARS-5): single `identifier` box (email OR phone) — Zitadel
 *     resolves it — plus password. Matches {@link LoginRequestSchema}, which is
 *     why this is NOT an `email` field.
 *   • Passwordless OTP login (EARS-6 email / EARS-7 SMS): request a code for an
 *     identifier+channel, then submit it on the focus-screen.
 */

export default function LoginPage() {
  const t = useTranslations("login");
  return (
    <AuthShell>
      <AuthCard
        title={t("title")}
        description={t("description")}
        icon={<ShieldCheck className="text-primary" aria-hidden />}
        footer={
          <>
            <Link href="/register" className="underline">
              {t("createAccount")}
            </Link>
            <Link href="/reset" className="underline">
              {t("forgotPassword")}
            </Link>
          </>
        }
      >
        {/* #179: pick a sign-in method first (segmented control) and render ONLY
            that method's fields — Radix Tabs unmounts the inactive `TabsContent`,
            so the password fields are absent from the DOM while the OTP tab is
            active and vice-versa. Defaults to Password (no "last-used" persistence
            — not persisting auth UI state matches the security posture). */}
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
            <PasswordLogin />
          </TabsContent>
          <TabsContent value="otp">
            <OtpLogin />
          </TabsContent>
        </Tabs>
      </AuthCard>
    </AuthShell>
  );
}

/** EARS-5 password login. */
function PasswordLogin() {
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
      router.push("/account");
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
          data-testid="password-login-submit"
        >
          {t("submit")}
        </Button>
      </form>
    </Form>
  );
}

/** EARS-6/7 passwordless OTP login: request a code, then submit it. */
function OtpLogin() {
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [channel, setChannel] = useState<OtpChannel>("email");
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function onRequest(values: OtpRequest) {
    setError(null);
    try {
      await authClient.requestOtp({
        ...values,
        channel,
        ...(captchaToken ? { captchaToken } : {}),
      });
      // Carry the identifier into the verify step (the BFF re-resolves it). The
      // verify form is a SEPARATE component (<OtpVerifyForm/>) that mounts only
      // once `sent` flips, so its own useForm registers the `code` field on its
      // first render — no late-mounted/detached Controller (#131/#153 live).
      setIdentifier(values.identifier);
      setSent(true);
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

          {/* Channel selector — drives EARS-6 (email) vs EARS-7 (sms). */}
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
                role="radio"
                aria-checked={channel === c}
                data-testid={`otp-channel-${c}`}
                onClick={() => {
                  setChannel(c);
                  setSent(false);
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
              {/* The OTP request box is channel-specific: the email channel is a
                  pure email, the sms channel a pure (masked) phone — so it uses the
                  channel-appropriate primitive, not the union box. Both keep the
                  `otp-identifier` test id (via the primitive `testId` prop) and the
                  masked-vs-unmasked behavior (#192). */}
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
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                disabled={requestForm.formState.isSubmitting}
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
          captchaToken={captchaToken}
          onBack={() => setSent(false)}
        />
      )}
    </div>
  );
}

/**
 * Zitadel's login email/SMS OTP codes are a FIXED 8 digits (verified live on the
 * dev-stand, #153). #175: that fixed length lets the field auto-submit the moment the
 * final digit lands, via the slotted `InputOTP onComplete`. #211 unified the
 * presentation onto the slotted variant — 8 slots fit the auth card.
 */
const LOGIN_OTP_LENGTH = 8;

/**
 * EARS-6/7 verify step — the reusable `<OtpFocusScreen>` (#227). Its OWN `useForm`
 * lives here so the `code` field is registered on this component's first render: the
 * component mounts only once the request step has fired, so there is no late-mounted
 * Controller (#131/#153 live). The focus-screen renders ONLY the issued-challenge
 * affordances — masked destination + code + submit + resend(cooldown) + back — so the
 * user cannot wander off the challenge. `identifier`+`channel` come in as props (the
 * BFF re-resolves them); the user only types the code, which auto-submits.
 */
function OtpVerifyForm({
  identifier,
  channel,
  captchaToken,
  onBack,
}: {
  identifier: string;
  channel: OtpChannel;
  captchaToken: string | null;
  onBack: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("login");
  const ta = useTranslations("auth");
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);

  const verifyForm = useForm<OtpVerify>({
    mode: "onTouched", // #200: consistent on-blur validation across the auth forms.
    resolver: useLocalizedResolver(OtpVerifySchema),
    defaultValues: { identifier, code: "", channel },
  });

  async function onVerify(values: OtpVerify) {
    setError(null);
    try {
      await authClient.loginWithOtp({ ...values, identifier, channel });
      router.push("/account");
    } catch (err) {
      setError(authErrorMessage(err, te, te("otpVerifyFailed")));
    }
  }

  // #175: auto-submit once the fixed-length login OTP is fully entered. The
  // in-flight guard (`isSubmitting`) prevents a double network call if completion
  // races a manual click / the Enter key, and stops a re-fire if a later
  // keystroke/paste keeps the value at full length.
  const submit = verifyForm.handleSubmit(onVerify);
  const onCodeComplete = useCallback(() => {
    if (verifyForm.formState.isSubmitting) return;
    void submit();
  }, [verifyForm.formState.isSubmitting, submit]);

  // #227 resend: re-request the SAME identifier+channel code. The block owns the
  // cooldown timer; this only fires the network call. Carry the request-step
  // captcha token if one was minted (the guard no-ops without a provider).
  async function onResend() {
    setError(null);
    try {
      await authClient.requestOtp({
        identifier,
        channel,
        ...(captchaToken ? { captchaToken } : {}),
      });
    } catch (err) {
      setError(authErrorMessage(err, te, te("otpSendFailed")));
    }
  }

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
            title={ta("enterCodeTitle")}
            sentToLabel={ta("sentTo", {
              destination: maskDestination(identifier),
            })}
            codeLabel={t("enterCode")}
            submitLabel={t("verifyAndSignIn")}
            resendLabel={ta("resend")}
            resendCountdownLabel={(s) => ta("resendCountdown", { seconds: s })}
            changeMethodLabel={ta("changeMethod")}
            cooldownSeconds={30}
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
