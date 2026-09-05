"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";

import {
  OtpVerifySchema,
  type LoginRequest,
  type OtpRequest,
  type OtpVerify,
} from "@ds/schemas";

import { AuthShell } from "@/components/auth-shell";
import {
  BotProtectionField,
  botProtectionFailureMessage,
  isBotProtectionRejected,
  isBotProtectionRequired,
  useBotProtectedAction,
} from "@/components/bot-protection";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { refreshHeaderAuth } from "@/lib/header-auth";
import {
  LoginIdentifierFormSchema,
  otpIdentifierFormSchema,
} from "@/lib/identifier-validation";
import { withReturnTarget } from "@/lib/registration-handoff";
import { completeReturnTarget } from "@/lib/registration-resume";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

import {
  LoginCard,
  type LoginCardCopy,
  type LoginCardOtpRequestValues,
  type LoginCardOtpVerifyValues,
  type LoginCardPasswordValues,
} from "@ds/design-system/blocks";

/*
 * Sign-in surface (#131, rebuilt on the design system in #237). Since #1666 the
 * whole composition — card frame, method tabs, password form, OTP request form and
 * the #227 focus screen — lives ONCE in the design-system `<LoginCard>` block, so
 * both storefronts sign in through the same implementation (AGENTS.md §6 cross-front
 * reuse, ADR-0013 A1). This page is the portal's thin host projection: copy from
 * `next-intl`, the localized zod resolvers, the live BFF (003 F2 password / F3 OTP)
 * via {@link authClient}, the EARS-16 outcome mapping, the bot-protection element and
 * the post-login routing. On success the BFF sets the `__Host-ds_session` cookie and
 * we route to the session-aware landing. No token ever touches this client (EARS-8).
 * Two journeys live here:
 *   • Password login (EARS-5): single `identifier` box (email OR phone) — Zitadel
 *     resolves it — plus password.
 *   • Passwordless OTP login (EARS-6 email / EARS-7 SMS): request a code for an
 *     identifier+channel, then the surface swaps to the focused OTP screen.
 *
 * The whole surface is wrapped in the brand `<AuthShell>` (the approved split-screen
 * look).
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
        <PortalLoginCard />
      </Suspense>
    </AuthShell>
  );
}

/** The portal projection of the shared `<LoginCard>` block. */
function PortalLoginCard() {
  const router = useRouter();
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  // 005 EARS-2: the carried registration-intent (guard-validated at every
  // consumption point; this surface only forwards or completes it).
  const returnTo = useSearchParams().get("returnTo");

  // ---- EARS-5 password login -------------------------------------------------
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordCaptchaError, setPasswordCaptchaError] = useState<
    string | null
  >(null);
  const passwordCaptcha = useBotProtectedAction({
    onVerified: () => setPasswordCaptchaError(null),
    onChallengeError: (failure) =>
      setPasswordCaptchaError(botProtectionFailureMessage(failure, te)),
    onActionError: (err) => {
      if (isBotProtectionRejected(err)) {
        setPasswordCaptchaError(te("captchaRejected"));
        return;
      }
      if (isBotProtectionRequired(err)) {
        setPasswordCaptchaError(te("captchaRequired"));
        return;
      }
      setPasswordError(authErrorMessage(err, te, te("loginFailed")));
    },
  });

  async function finishLogin(values: LoginRequest, captchaToken?: string) {
    await authClient.login({
      ...values,
      ...(captchaToken ? { captchaToken } : {}),
    });
    // The BFF set the `__Host-` cookie; the session shell reads it server-side.
    // 005 EARS-2: with a carried event context the session now exists, so the
    // registration completes and the doctor lands back on that event page;
    // without one this is the 008 EARS-7 discovery front-door landing.
    // #1004: signal the persistent header to re-read the profile so the avatar
    // appears on this SOFT landing, without a hard reload.
    refreshHeaderAuth();
    router.push(await completeReturnTarget(returnTo));
  }

  async function onPasswordSubmit(values: LoginCardPasswordValues) {
    setPasswordError(null);
    setPasswordCaptchaError(null);
    try {
      await finishLogin(values);
    } catch (err) {
      if (isBotProtectionRequired(err)) {
        const original = {
          identifier: values.identifier,
          password: values.password,
        };
        passwordCaptcha.request((captchaToken) =>
          finishLogin(original, captchaToken),
        );
        return;
      }
      // EARS-16: the login OUTCOME (wrong credential / unknown account) stays the
      // generic message so the UI never leaks an existence/error oracle. Only the
      // non-oracle statuses get a specific message: 429 → too-many-attempts,
      // 5xx/network → temporarily-unavailable.
      setPasswordError(authErrorMessage(err, te, te("loginFailed")));
    }
  }

  // ---- EARS-6/7 passwordless OTP login --------------------------------------
  // The block owns the channel selection and hands it back on every handler call;
  // the host owns the stage (a code is "sent" only once the protected request
  // actually succeeded — the bot-protection callback is the only place that knows).
  const [sentIdentifier, setSentIdentifier] = useState<string | null>(null);
  // #266: a successful resend bumps this nonce, which restarts the focus-screen
  // cooldown and clears the superseded typed code WITHOUT a remount.
  const [resendNonce, setResendNonce] = useState(0);
  const [otpRequestError, setOtpRequestError] = useState<string | null>(null);
  const [otpCaptchaError, setOtpCaptchaError] = useState<string | null>(null);
  const [otpVerifyError, setOtpVerifyError] = useState<string | null>(null);
  const otpCaptcha = useBotProtectedAction({
    onVerified: () => setOtpCaptchaError(null),
    onChallengeError: (failure) =>
      setOtpCaptchaError(botProtectionFailureMessage(failure, te)),
    onActionError: (err) => {
      if (isBotProtectionRejected(err)) {
        setOtpCaptchaError(te("captchaRejected"));
        return;
      }
      if (isBotProtectionRequired(err)) {
        setOtpCaptchaError(te("captchaRequired"));
        return;
      }
      setOtpRequestError(authErrorMessage(err, te, te("otpSendFailed")));
    },
  });

  async function sendOtp(
    identifier: string,
    channel: OtpRequest["channel"],
    captchaToken?: string,
  ) {
    await authClient.requestOtp({
      identifier,
      channel,
      ...(captchaToken ? { captchaToken } : {}),
    });
  }

  function onOtpRequest(values: LoginCardOtpRequestValues) {
    setOtpRequestError(null);
    otpCaptcha.request(async (captchaToken) => {
      await sendOtp(values.identifier, values.channel, captchaToken);
      // Carry the identifier into the focus-screen (the BFF re-resolves it on
      // verify); flipping it non-null is what mounts the verify stage.
      setSentIdentifier(values.identifier);
      setResendNonce(0);
    });
  }

  // #227/#266 resend: re-request the SAME identifier+channel code. On success bump the
  // nonce (the focus-screen restarts its cooldown + the verify form clears the stale
  // code, both without a remount); on failure surface the error and leave the screen.
  function onOtpResend(values: LoginCardOtpRequestValues) {
    setOtpRequestError(null);
    otpCaptcha.request(async (captchaToken) => {
      await sendOtp(values.identifier, values.channel, captchaToken);
      setResendNonce((n) => n + 1);
    });
  }

  async function onOtpVerify(values: LoginCardOtpVerifyValues) {
    setOtpVerifyError(null);
    try {
      await authClient.loginWithOtp(values as OtpVerify);
      // 005 EARS-2: complete the carried registration (if any) now the session
      // exists, landing on the event page — else the 008 EARS-7 front-door.
      // #1004: soft landing → signal the header's auth re-read (see above).
      refreshHeaderAuth();
      router.push(await completeReturnTarget(returnTo));
    } catch (err) {
      setOtpVerifyError(authErrorMessage(err, te, te("otpVerifyFailed")));
    }
  }

  function resetOtpStage() {
    setSentIdentifier(null);
    setOtpRequestError(null);
    setOtpCaptchaError(null);
    setOtpVerifyError(null);
  }

  // Switching method used to unmount the whole sub-form (Radix drops the inactive
  // `TabsContent`), clearing its errors and any issued-code stage. The block still
  // unmounts its own state; this clears the state the host now holds, so the
  // observable behaviour is unchanged.
  function onMethodChange() {
    setPasswordError(null);
    setPasswordCaptchaError(null);
    resetOtpStage();
  }

  // ---- resolvers (app-owned: localized messages + the portal identifier guards) --
  const emailRequestSchema = useMemo(() => otpIdentifierFormSchema("email"), []);
  const smsRequestSchema = useMemo(() => otpIdentifierFormSchema("sms"), []);
  const passwordResolver = useLocalizedResolver(LoginIdentifierFormSchema);
  const emailRequestResolver = useLocalizedResolver(emailRequestSchema);
  const smsRequestResolver = useLocalizedResolver(smsRequestSchema);
  const verifyResolver = useLocalizedResolver(OtpVerifySchema);

  const copy: LoginCardCopy = {
    title: t("title"),
    description: t("description"),
    createAccount: t("createAccount"),
    forgotPassword: t("forgotPassword"),
    methodSwitcherLabel: t("methodSwitcherLabel"),
    methodPassword: t("methodPassword"),
    methodOtp: t("methodOtp"),
    password: {
      formLabel: t("passwordFormLabel"),
      identifierLabel: tc("emailOrPhone"),
      identifierPlaceholder: tc("identifierPlaceholder"),
      passwordLabel: tc("password"),
      submit: t("submit"),
    },
    otp: {
      formLabel: t("otpFormLabel"),
      heading: t("otpHeading"),
      description: t("otpDescription"),
      channelGroupLabel: t("otpChannelGroupLabel"),
      channelEmail: t("otpChannelEmail"),
      channelSms: t("otpChannelSms"),
      emailLabel: tc("email"),
      emailPlaceholder: tc("emailPlaceholder"),
      phoneLabel: tc("phone"),
      phonePlaceholder: tc("shortPhonePlaceholder"),
      sendCode: t("sendCode"),
      verifyTitle: t("otpVerifyTitle"),
      sentTo: (destination) => t("otpSentTo", { destination }),
      codeLabel: t("enterCode"),
      verifySubmit: t("verifyAndSignIn"),
      resend: t("resend"),
      resendCountdown: (seconds) => t("resendIn", { seconds }),
      changeMethod: t("changeMethod"),
    },
  };

  return (
    <LoginCard
      icon={<ShieldCheck className="text-primary" aria-hidden />}
      copy={copy}
      // 005 EARS-2: signup is a co-equal auth path — the event context rides
      // onward into /register so it survives this hop too.
      links={{ register: withReturnTarget("/register", returnTo), reset: "/reset" }}
      // Next.js `<Link>` keeps the footer links on client-side navigation.
      renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
      onMethodChange={onMethodChange}
      password={{
        resolver: passwordResolver,
        onSubmit: onPasswordSubmit,
        error: passwordCaptchaError ?? passwordError,
        pending: passwordCaptcha.pending,
        captchaSlot: <BotProtectionField {...passwordCaptcha.fieldProps} />,
      }}
      otp={{
        requestResolvers: {
          email: emailRequestResolver,
          sms: smsRequestResolver,
        },
        verifyResolver,
        sentIdentifier,
        resendNonce,
        error: otpCaptchaError ?? otpRequestError,
        screenError: otpCaptchaError ?? otpRequestError ?? otpVerifyError,
        pending: otpCaptcha.pending,
        captchaSlot: <BotProtectionField {...otpCaptcha.fieldProps} />,
        onRequest: onOtpRequest,
        onResend: onOtpResend,
        onVerify: onOtpVerify,
        onChangeMethod: resetOtpStage,
      }}
    />
  );
}
