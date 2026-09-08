"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EmailIdentifierSchema, PhoneIdentifierSchema } from "@ds/schemas";
import {
  IdentifierFieldSchema,
  OtpCodeFieldSchema,
} from "@ds/design-system/fields";
import {
  LoginCard,
  type LoginCardCopy,
  type LoginCardOtpChannel,
  type LoginCardOtpRequestValues,
  type LoginCardOtpVerifyValues,
  type LoginCardPasswordValues,
} from "@ds/design-system/blocks";

import { completeReturnTarget } from "@ds/events-storefront";

import { authClient } from "@/lib/auth-client";
import {
  AUTH_GENERIC_MESSAGES,
  authErrorMessage,
} from "@/lib/auth-error-message";
import { makeResolver } from "@/lib/make-resolver";
import { doctorReturnHost } from "@/lib/return-completion";

/**
 * #1933 — the doctor storefront sign-in screen (`doctor.school/login`).
 *
 * This is a HOST PROJECTION, not a screen. Since #1666 the entire sign-in
 * composition — card frame, method tabs, the EARS-5 password form, the EARS-6/7
 * OTP request form and the #227 focus screen with its resend cooldown — lives
 * ONCE in the `@ds/design-system/blocks` `<LoginCard>`, and both storefronts
 * sign in through that one implementation (AGENTS.md §6 cross-front reuse,
 * ADR-0013 A1; registry row «Auth flows» in
 * `specs/product/two-site-ia/capability-ownership.md`). What this file adds is
 * only what a host may add: RU copy, the doctor identifier guards, this origin
 * transport, the EARS-16 outcome mapping and the post-login route. There is no
 * doctor-local card, no copied markup and no second state machine — a fork of
 * any of those would be the exact divergence the registry exists to prevent.
 *
 * WHY THE SURFACE EXISTS. The 017 shell guest cluster
 * (`components/storefront-header.tsx`) has pointed at `/login` since 017
 * shipped, and the route did not exist — the header «Войти» resolved to a 404
 * for every signed-out visitor. This closes that link, exactly as #1538 closed
 * its «Регистрация» sibling.
 *
 * NO `next-intl`, BY DECISION. `apps/doctor` is a single-locale RU app whose
 * root layout ships no provider, so the copy is literal here as it is in
 * `registration-screen.tsx` — and the resolvers below are hand-written for the
 * same reason: the portal `useLocalizedResolver` exists to translate zod issue
 * codes into a catalogue this app does not have (the shaping helper itself is
 * `lib/make-resolver.ts`, shared with `/reset` since #1989). The GUARDS themselves are NOT
 * re-invented: `IdentifierFieldSchema` (the email-or-E.164 union the login box
 * takes), the per-channel `EmailIdentifierSchema` / `PhoneIdentifierSchema` and
 * `OtpCodeFieldSchema` are the shared shapes the portal validates with; only the
 * sentence shown to the doctor is doctor-owned.
 *
 * NO BOT-PROTECTION SLOT. The `<LoginCard>` `captchaSlot` is optional and stays
 * unsupplied: the widget is portal-local and the doctor host copy of it is
 * tracked at #1558 (the same dependency keeping `/register` submit inert).
 * Ordinary sign-in is unburdened — `POST /v1/auth/login` is `@LoginChallenged()`,
 * captcha-after-N-failures — so the password journey works today; the challenged
 * path and the `@BotProtected("otp-request")` OTP request surface an honest RU
 * message through `lib/auth-error-message.ts` rather than a dead slot.
 */

export type LoginScreenProps = {
  /**
   * `/register` carrying the validated return target, built on the server so the
   * raw param never reaches the client. Sign-up is a co-equal auth path, so the
   * arrival context survives the hop into it.
   */
  registerHref: string;
  /**
   * WHERE A SUCCESSFUL SIGN-IN LANDS, decided on the server: the guard own
   * reconstruction of a gate arrival return target, else the LD-4 decision
   * (`lib/registration-landing.ts` — the 019 events feed when 017 remembers a
   * specialty, the storefront home otherwise). The same one-vocabulary fact
   * `/register` publishes as `data-registration-landing`; nothing here
   * recomputes it, and the raw `returnTo` is never navigated to.
   */
  landing: string;
  /**
   * 005 EARS-2 — the arrival target to COMPLETE once the session exists, in the
   * doctor host own vocabulary (`/events/<slug>`).
   *
   * Not the raw `returnTo` param and not {@link landing}: the route hands over
   * the projection its own guard already reconstructed
   * (`lib/return-context.ts` `resolveReturnLandingPath`, #1945), so the raw param
   * never reaches the client and the academy `/webinars/<slug>` the gate emits is
   * already this host's `/events/<slug>` by the time the rule sees it. The SAME
   * prop and the same value `registration-screen.tsx` carries through the confirm
   * hop — one vocabulary across both doors. Absent on a direct arrival and on an
   * arrival whose target did not resolve, and then the landing simply stands.
   */
  returnTarget?: string;
  /** The gate context the doctor arrived from — the mobile plate (021 EARS-2). */
  returnContext?: ReactNode;
};

const IDENTIFIER_REQUIRED = "Введите почту или телефон.";
const IDENTIFIER_MALFORMED =
  "Проверьте: почта вида doctor@clinic.ru или телефон в формате +79991234567.";
const EMAIL_MALFORMED = "Проверьте адрес: он должен быть вида doctor@clinic.ru.";
const PHONE_MALFORMED = "Проверьте номер: он должен быть в формате +79991234567.";
const PASSWORD_REQUIRED = "Введите пароль.";
const CODE_MALFORMED = "Код состоит из 8 цифр — проверьте, что ввели все.";

/** EARS-5 — the union box: Zitadel resolves whichever identifier was typed. */
const passwordResolver = makeResolver<LoginCardPasswordValues>({
  identifier: (value) => {
    if (!value?.trim()) return IDENTIFIER_REQUIRED;
    return IdentifierFieldSchema.safeParse(value).success
      ? null
      : IDENTIFIER_MALFORMED;
  },
  // Length only — 003 EARS-36 owns the password policy and no surface may
  // declare a second one. The credential authority is the BFF, not this form.
  password: (value) => (value?.length ? null : PASSWORD_REQUIRED),
});

/** EARS-6/7 — the channel decides the shape: an email box or an E.164 box. */
function otpRequestResolver(channel: LoginCardOtpChannel) {
  return makeResolver<LoginCardOtpRequestValues>({
    identifier: (value) => {
      if (!value?.trim()) return IDENTIFIER_REQUIRED;
      const schema =
        channel === "email" ? EmailIdentifierSchema : PhoneIdentifierSchema;
      if (schema.safeParse(value).success) return null;
      return channel === "email" ? EMAIL_MALFORMED : PHONE_MALFORMED;
    },
  });
}

const otpVerifyResolver = makeResolver<LoginCardOtpVerifyValues>({
  code: (value) =>
    OtpCodeFieldSchema.safeParse(value).success ? null : CODE_MALFORMED,
});

/**
 * Every visible string on the surface, stated once. The wording is the doctor
 * storefront own voice (RU, «врач» not «пользователь»); the STRUCTURE is the
 * block, which is why there is one entry per slot and no free markup here.
 */
const COPY: LoginCardCopy = {
  title: "Вход",
  description: "Войдите, чтобы участвовать в эфирах и получать баллы НМО.",
  createAccount: "Создать аккаунт",
  forgotPassword: "Забыли пароль?",
  methodSwitcherLabel: "Способ входа",
  methodPassword: "По паролю",
  methodOtp: "По коду",
  password: {
    formLabel: "Вход по паролю",
    identifierLabel: "Почта или телефон",
    identifierPlaceholder: "doctor@clinic.ru",
    passwordLabel: "Пароль",
    submit: "Войти",
  },
  otp: {
    formLabel: "Вход по одноразовому коду",
    heading: "Вход без пароля",
    description: "Пришлём одноразовый код — пароль вводить не нужно.",
    channelGroupLabel: "Куда прислать код",
    channelEmail: "На почту",
    channelSms: "В СМС",
    emailLabel: "Рабочая почта",
    emailPlaceholder: "doctor@clinic.ru",
    phoneLabel: "Телефон",
    phonePlaceholder: "+7 999 123-45-67",
    sendCode: "Прислать код",
    verifyTitle: "Введите код",
    sentTo: (destination) => "Код отправлен на " + destination,
    codeLabel: "Код из сообщения",
    verifySubmit: "Войти",
    resend: "Прислать код ещё раз",
    resendCountdown: (seconds) =>
      "Отправить снова можно через " + seconds + " с",
    changeMethod: "Другой способ входа",
  },
};

export function LoginScreen({
  registerHref,
  landing,
  returnTarget,
  returnContext,
}: LoginScreenProps) {
  const router = useRouter();

  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [otpRequestError, setOtpRequestError] = useState<string | null>(null);
  const [otpVerifyError, setOtpVerifyError] = useState<string | null>(null);
  // Non-null once a code was actually issued — that flip is what mounts the
  // focus screen, so the host owns it and the block never guesses.
  const [sentIdentifier, setSentIdentifier] = useState<string | null>(null);
  // Bumped on each SUCCESSFUL resend: restarts the cooldown and clears the
  // superseded code without remounting the screen (#266).
  const [resendNonce, setResendNonce] = useState(0);
  const [otpPending, setOtpPending] = useState(false);

  /**
   * The session now exists on this origin. The 017 shell reads it SERVER-side
   * (`lib/shell-auth.ts`), so `refresh()` — not a client header-refresh helper —
   * is what makes the signed-in cluster appear; `push` then takes the doctor
   * where the completed return decides.
   *
   * 005 EARS-2 — and the doctor who arrived from a gated эфир is REGISTERED to it
   * here, not merely returned to it. The decision is the ONE shared rule
   * (`@ds/events-storefront` `completeReturnTarget`, the Academy's rule verbatim);
   * this host contributes only its own projection of it
   * (`lib/return-completion.ts` — which shapes are ours, where nothing lands).
   * The registration is best-effort by that rule's contract: a refusal still
   * lands the doctor on the эфир, where the per-viewer participation read (005
   * EARS-4) tells them the truth, rather than stranding them on a listing.
   */
  async function finishLogin() {
    const target = await completeReturnTarget(
      returnTarget ?? null,
      doctorReturnHost(landing),
    );
    router.push(target);
    router.refresh();
  }

  async function onPasswordSubmit(values: LoginCardPasswordValues) {
    setPasswordError(null);
    try {
      await authClient.login({
        identifier: values.identifier.trim(),
        password: values.password,
      });
      await finishLogin();
    } catch (err) {
      setPasswordError(authErrorMessage(err, AUTH_GENERIC_MESSAGES.login));
    }
  }

  async function sendOtp(values: LoginCardOtpRequestValues, resend: boolean) {
    setOtpRequestError(null);
    // A fresh code is in flight: the previous code verify error is stale.
    setOtpVerifyError(null);
    setOtpPending(true);
    try {
      await authClient.requestOtp({
        identifier: values.identifier.trim(),
        channel: values.channel,
      });
      if (resend) {
        setResendNonce((n) => n + 1);
      } else {
        // The BFF re-resolves the identifier on verify; carrying it forward is
        // what the focus screen masks in its «код отправлен на …» line.
        setSentIdentifier(values.identifier.trim());
        setResendNonce(0);
      }
    } catch (err) {
      setOtpRequestError(authErrorMessage(err, AUTH_GENERIC_MESSAGES.otpSend));
    } finally {
      setOtpPending(false);
    }
  }

  async function onOtpVerify(values: LoginCardOtpVerifyValues) {
    setOtpVerifyError(null);
    try {
      // Mapped field by field rather than cast: the block structural values type
      // and the `OtpVerify` contract coincide today, and a future field on the
      // contract must fail typecheck HERE rather than ship a silent omission.
      await authClient.loginWithOtp({
        identifier: values.identifier,
        code: values.code,
        channel: values.channel,
      });
      await finishLogin();
    } catch (err) {
      setOtpVerifyError(authErrorMessage(err, AUTH_GENERIC_MESSAGES.otpVerify));
    }
  }

  /** Leave the focus screen: drop the issued-code stage and its errors. */
  function resetOtpStage() {
    setSentIdentifier(null);
    setOtpRequestError(null);
    setOtpVerifyError(null);
  }

  /**
   * Radix unmounts the inactive tab, so the per-method state inside the block
   * resets by construction; this clears the state the HOST holds, which that
   * unmount cannot reach — otherwise a failed password attempt error would still
   * be standing when the doctor came back to the tab.
   */
  function onMethodChange() {
    setPasswordError(null);
    resetOtpStage();
  }

  const otpResolvers = useMemo(
    () => ({
      email: otpRequestResolver("email"),
      sms: otpRequestResolver("sms"),
    }),
    [],
  );

  return (
    <div
      data-testid="login-screen"
      // The server landing decision, carried on the element the command belongs
      // to — the same read model and the same vocabulary `/register` publishes
      // as `data-registration-landing` (021 LD-3/LD-4).
      data-login-landing={landing}
      className="flex w-full flex-col gap-4.5"
    >
      {/* Supplied or absent, never an empty frame (021 EARS-3 honest-empty rule). */}
      {returnContext ? (
        <div data-testid="login-return-context">{returnContext}</div>
      ) : null}

      <LoginCard
        icon={<SignInGlyph />}
        copy={COPY}
        links={{
          // Sign-up is a co-equal path and the arrival context rides onward.
          register: registerHref,
          // Password recovery is THIS host's own surface since #1989
          // (`app/(auth)/reset/page.tsx`, the shared `<PasswordRecoveryCard>`),
          // so the link is host-relative: a doctor who forgot a password stays
          // on the storefront and comes back signed in here, on the origin the
          // `__Host-` session belongs to. The #1933 interim that pointed at the
          // Academy `/reset` is gone with the route that made it necessary.
          reset: "/reset",
        }}
        // Next.js `<Link>` keeps the footer links on client-side navigation.
        renderLink={({ href, children }) => <Link href={href}>{children}</Link>}
        onMethodChange={onMethodChange}
        password={{
          resolver: passwordResolver,
          onSubmit: onPasswordSubmit,
          error: passwordError,
        }}
        otp={{
          requestResolvers: otpResolvers,
          verifyResolver: otpVerifyResolver,
          sentIdentifier,
          resendNonce,
          error: otpRequestError,
          screenError: otpRequestError ?? otpVerifyError,
          pending: otpPending,
          onRequest: (values) => void sendOtp(values, false),
          onResend: (values) => void sendOtp(values, true),
          onVerify: onOtpVerify,
          onChangeMethod: resetOtpStage,
        }}
      />
    </div>
  );
}

/**
 * The card-head glyph. Drawn inline rather than pulled from an icon package, for
 * the reason `registration-screen.tsx` states: `apps/doctor` ships no icon
 * dependency, and adding one for a single decorative mark is a heavier change
 * than the mark. Purely decorative — the heading carries the meaning.
 */
function SignInGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      focusable="false"
    >
      <path
        d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z"
        strokeWidth="2"
        strokeLinecap="square"
      />
      <path d="m9 12 2 2 4-4" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
