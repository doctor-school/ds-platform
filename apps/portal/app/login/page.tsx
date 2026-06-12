"use client";

import { useMemo, useState } from "react";
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
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import {
  LoginIdentifierFormSchema,
  maskPhoneInput,
  otpIdentifierFormSchema,
} from "@/lib/identifier-validation";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import { Button } from "@ds/design-system/button";
import { Input } from "@ds/design-system/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ds/design-system/tabs";

/*
 * Sign-in surface (#131). Wires the live BFF (003 F2 password / F3 OTP) into the
 * portal: forms validate with the `@ds/schemas` SSOT (NO re-declared zod), submit
 * same-origin to `/v1/auth/*` via {@link authClient}, and on success the BFF sets
 * the `__Host-ds_session` cookie and we route to the session-aware `/account`
 * landing. No token ever touches this client (EARS-8). Two journeys live here:
 *   • Password login (EARS-5): single `identifier` box (email OR phone) — Zitadel
 *     resolves it — plus password. Matches {@link LoginRequestSchema}, which is
 *     why this is NOT an `email` field (the old scaffold was wrong).
 *   • Passwordless OTP login (EARS-6 email / EARS-7 SMS): request a code for an
 *     identifier+channel, then submit the 6-digit code. SMS has no dev-stand
 *     provider, but the UI is built for both channels.
 */

export default function LoginPage() {
  const t = useTranslations("login");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary" aria-hidden />
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* #179: pick a sign-in method first (segmented control) and render
              ONLY that method's fields — Radix Tabs unmounts the inactive
              `TabsContent`, so the password fields are absent from the DOM while
              the OTP tab is active and vice-versa. Defaults to Password (no
              "last-used" persistence — not persisting auth UI state matches the
              security posture). Each method's component is unchanged; this is a
              COMPOSITION-only change. */}
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
        </CardContent>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <Link href="/register" className="underline">
            {t("createAccount")}
          </Link>
          <Link href="/reset" className="underline">
            {t("forgotPassword")}
          </Link>
        </CardFooter>
      </Card>
    </main>
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
        <FormField
          control={form.control}
          name="identifier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tc("emailOrPhone")}</FormLabel>
              <FormControl>
                <Input
                  autoComplete="username"
                  placeholder={tc("identifierPlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tc("password")}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
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
  // it. `reValidateMode` keeps the live error in sync after the channel flips.
  const requestResolverSchema = useMemo(
    () => otpIdentifierFormSchema(channel),
    [channel],
  );
  const requestForm = useForm<OtpRequest>({
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
      // first render — no late-mounted/detached Controller. A prior attempt kept
      // the verify form in this component and seeded it with reset()/setValue()
      // after the request→verify toggle; because the `code` Controller mounted
      // AFTER the form was created, RHF never bound it and every keystroke was
      // dropped (the field stayed "" and login never fired). Owning the verify
      // form in a freshly-mounted child is the idiomatic fix (#131/#153 live).
      setIdentifier(values.identifier);
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err, te, te("otpSendFailed")));
    }
  }

  return (
    <div className="space-y-4" aria-label={t("otpFormLabel")}>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("otpHeading")}</p>
        <p className="text-xs text-muted-foreground">{t("otpDescription")}</p>
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

      {!sent ? (
        <Form {...requestForm}>
          <form
            onSubmit={requestForm.handleSubmit(onRequest)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={requestForm.control}
              name="identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {channel === "email" ? tc("email") : tc("phone")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete={channel === "email" ? "email" : "tel"}
                      inputMode={channel === "email" ? "email" : "tel"}
                      placeholder={
                        channel === "email"
                          ? tc("emailPlaceholder")
                          : tc("shortPhonePlaceholder")
                      }
                      data-testid="otp-identifier"
                      {...field}
                      // #192 phone mask: on the SMS channel, coerce keystrokes into
                      // an E.164-valid `+<digits>` value as the user types (RU `8…`
                      // → `+7…`), so the stored value is always submit-shaped and
                      // the box can only hold a phone. Email channel is unmasked.
                      onChange={
                        channel === "sms"
                          ? (e) =>
                              field.onChange(maskPhoneInput(e.target.value))
                          : field.onChange
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
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
      ) : (
        <OtpVerifyForm
          identifier={identifier}
          channel={channel}
          onBack={() => setSent(false)}
        />
      )}
    </div>
  );
}

/**
 * EARS-6/7 verify step. Its OWN `useForm` lives here so the `code` field is
 * registered on this component's first render: the component mounts only once
 * the request step has fired, so there is no late-mounted Controller and no
 * post-hoc `reset()`/`setValue()` seeding (both of which left the field detached
 * and dropped every keystroke — #131/#153 live). `identifier`+`channel` come in
 * as props (the BFF re-resolves them); the user only types the code.
 */
function OtpVerifyForm({
  identifier,
  channel,
  onBack,
}: {
  identifier: string;
  channel: OtpChannel;
  onBack: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);

  const verifyForm = useForm<OtpVerify>({
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

  return (
    <Form {...verifyForm}>
      <form
        onSubmit={verifyForm.handleSubmit(onVerify)}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={verifyForm.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("enterCode")}</FormLabel>
              <FormControl>
                {/* A plain one-time-code input, NOT the fixed-width slotted
                    `InputOTP`. Zitadel's login email/SMS OTP codes are 8 digits
                    (verified live on the dev-stand, #153) — longer than the
                    6-char registration code on /verify and variable enough that a
                    fixed-slot widget is the wrong control here. A standard numeric
                    input takes the full code in one shot, keeps
                    `autocomplete="one-time-code"` for OS autofill, and is what the
                    BFF's `code: z.string().min(1)` expects. */}
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t("codePlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            className="flex-1"
            disabled={verifyForm.formState.isSubmitting}
            data-testid="otp-verify"
          >
            {t("verifyAndSignIn")}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            {tc("back")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
