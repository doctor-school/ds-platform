import { createAuthClient } from "@ds/auth-flow/client";
import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
} from "@ds/auth-flow/host-config";

import { ACADEMY_AUTH_ROUTES, ACADEMY_AUTH_RETURN_TO } from "@/lib/auth-flow-routes";

import ru from "../messages/ru.json";

/**
 * What the Academy states about itself so the shared auth flow can serve it
 * (#2027, epic #2020 wave 1).
 *
 * The host value file of `@ds/auth-flow`, in the same role as `lib/room-config.ts`
 * is for `@ds/room`: the RULES (the transport, the error branch, the field
 * shapes) live in the package once; the PATHS, the CHANNELS, the site key and
 * every sentence a doctor reads are this host's and live here.
 */

/**
 * The Academy proxies the shipped 003 routes directly — registration and
 * confirmation are the same `/v1/auth/*` commands the api has always exposed,
 * unlike the doctor storefront, which posts its own storefront commands.
 */
export const ACADEMY_AUTH_FLOW_API: AuthFlowApiConfig = {
  basePath: "/v1/auth",
  registerPath: "/v1/auth/register",
  confirmPath: "/v1/auth/verify",
};

/**
 * The bound transport. A module constant because the paths are static.
 */
export const authClient = createAuthClient(ACADEMY_AUTH_FLOW_API);

/** The Academy's catalogue, read as DATA — this host is single-locale RU (`i18n/request.ts`). */
const m = ru;

/**
 * Fill a next-intl ICU placeholder into the package's `{name}` template shape.
 * The two share the syntax for a plain argument, so the catalogue string IS the
 * template; this only asserts it at build time rather than trusting it silently.
 */
function template(message: string, placeholder: string): string {
  if (!message.includes(`{${placeholder}}`)) {
    throw new Error(`auth-flow copy: "${message}" has no {${placeholder}}`);
  }
  return message;
}

/**
 * The full host config — a plain constant (#2027 PR 1.5).
 *
 * DATA, not a hook: the sign-in door is mounted by a server route file that can
 * only pass an imported identifier to the package, so the copy is read straight
 * from `messages/ru.json` rather than through the render-time translator. The
 * literal `process.env.NEXT_PUBLIC_…` expression is what Next inlines at build,
 * which is why the site-key read lives in the app rather than in the package.
 */
export const ACADEMY_AUTH_FLOW = {
  api: ACADEMY_AUTH_FLOW_API,
  // The route table and the parking declaration are stated in
  // `lib/auth-flow-routes.ts`, because `middleware.ts` and the server auth
  // layouts read the same values.
  routes: ACADEMY_AUTH_ROUTES,
  returnTo: ACADEMY_AUTH_RETURN_TO,
  // 013 EARS-15 — no carried target lands on the discovery listing, never the
  // marketing landing; this host keeps no specialty memory (row 38).
  landing: { afterLogin: "/webinars", specialtyAware: false },
  copy: {
    errors: {
      tooManyAttempts: m.errors.tooManyAttempts,
      unavailable: m.errors.unavailable,
      // The same two sentences the shared challenge block already shows for
      // these states — the 403 from the guard is the SAME obstacle.
      botProtectionRequired: m.errors.captchaRequired,
      botProtectionRejected: m.errors.captchaRejected,
    },
    botProtection: {
      unavailable: m.errors.captchaUnavailable,
      rejected: m.errors.captchaRejected,
      required: m.errors.captchaRequired,
    },
    fields: {
      email: { required: m.errors.validation.required, invalid: m.errors.validation.email },
      password: {
        required: m.errors.validation.required,
        invalid: m.errors.validation.passwordTooShort,
      },
      code: { required: m.errors.validation.codeRequired, invalid: m.errors.validation.codeRequired },
      identifier: {
        required: m.errors.validation.identifierRequired,
        invalid: m.errors.validation.identifierRequired,
      },
      phone: { required: m.errors.validation.phone, invalid: m.errors.validation.phone },
      // No `promoCode`: the Academy registration form has no promo box.
    },
    login: {
      title: m.login.title,
      description: m.login.description,
      createAccount: m.login.createAccount,
      forgotPassword: m.login.forgotPassword,
      methodSwitcherLabel: m.login.methodSwitcherLabel,
      methodPassword: m.login.methodPassword,
      methodOtp: m.login.methodOtp,
      password: {
        formLabel: m.login.passwordFormLabel,
        identifierLabel: m.common.emailOrPhone,
        identifierPlaceholder: m.common.identifierPlaceholder,
        passwordLabel: m.common.password,
        // The shared login rule reports a short password as the 8-character
        // policy, and an empty box is the shortest password there is.
        passwordRequired: m.errors.validation.passwordTooShort,
        reveal: {
          show: m.common.passwordShow,
          hide: m.common.passwordHide,
          showAria: m.common.passwordShowAria,
          hideAria: m.common.passwordHideAria,
        },
        submit: m.login.submit,
      },
      otp: {
        formLabel: m.login.otpFormLabel,
        heading: m.login.otpHeading,
        description: m.login.otpDescription,
        channelGroupLabel: m.login.otpChannelGroupLabel,
        channelEmail: m.login.otpChannelEmail,
        channelSms: m.login.otpChannelSms,
        emailLabel: m.common.email,
        emailPlaceholder: m.common.emailPlaceholder,
        phoneLabel: m.common.phone,
        phonePlaceholder: m.common.shortPhonePlaceholder,
        sendCode: m.login.sendCode,
        verifyTitle: m.login.otpVerifyTitle,
        sentTo: template(m.login.otpSentTo, "destination"),
        codeLabel: m.login.enterCode,
        codeInvalid: m.errors.validation.codeRequired,
        verifySubmit: m.login.verifyAndSignIn,
        resend: m.login.resend,
        resendCountdown: template(m.login.resendIn, "seconds"),
        changeMethod: m.login.changeMethod,
      },
      failed: {
        password: m.errors.loginFailed,
        otpRequest: m.errors.otpSendFailed,
        otpVerify: m.errors.otpVerifyFailed,
      },
    },
  },
  botProtection: {
    siteKey: process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY,
  },
  // The Academy serves sign-in codes over both channels, so its identifier box
  // is the email-or-E.164 union.
  channels: ["email", "sms"],
  register: { promoField: false },
} satisfies AuthFlowHostConfig;
