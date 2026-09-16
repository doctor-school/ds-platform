import {
  PASSWORD_MIN_LENGTH,
  PROMO_CODE_MAX_LENGTH,
} from "@ds/schemas";

import { createAuthClient } from "@ds/auth-flow/client";
import type { AuthFlowApiConfig, AuthFlowHostConfig } from "@ds/auth-flow/host-config";

/**
 * What the doctor storefront states about itself so the shared auth flow can
 * serve it (#2027, epic #2020 wave 1).
 *
 * The host value file of `@ds/auth-flow` on this host. A plain constant rather
 * than the Academy's hook: this storefront ships no i18n runtime, so every
 * sentence is an RU literal here, and the site key is read by the literal
 * `process.env.NEXT_PUBLIC_…` expression Next inlines at build. Each sentence
 * below is the one this storefront already shipped — this file re-homes the
 * copy, it rewords nothing.
 */

/**
 * Registration and confirmation are the storefront's OWN commands (021 EARS-19):
 * they carry the doctor profile the `/v1/auth/*` pair knows nothing about.
 * Everything else — sign-in, codes, recovery, session — is the same shared
 * `/v1/auth` surface the Academy posts to.
 */
export const DOCTOR_AUTH_FLOW_API: AuthFlowApiConfig = {
  basePath: "/v1/auth",
  registerPath: "/v1/storefront/doctor/register",
  confirmPath: "/v1/storefront/doctor/confirm",
};

/** The bound transport every doctor auth screen calls. */
export const authClient = createAuthClient(DOCTOR_AUTH_FLOW_API);

export const DOCTOR_AUTH_FLOW = {
  api: DOCTOR_AUTH_FLOW_API,
  copy: {
    errors: {
      tooManyAttempts:
        "Слишком много попыток. Подождите пару минут и попробуйте снова.",
      unavailable: "Сервис временно недоступен. Попробуйте ещё раз через минуту.",
      // #1558: this storefront still cannot RENDER a challenge, so both guard
      // codes say so and name the way forward, rather than blaming a password.
      botProtectionRequired:
        "Нужна дополнительная проверка, которую эта страница пока не умеет показывать. Попробуйте позже или войдите по паролю на academy.doctor.school.",
      botProtectionRejected:
        "Нужна дополнительная проверка, которую эта страница пока не умеет показывать. Попробуйте позже или войдите по паролю на academy.doctor.school.",
    },
    botProtection: {
      required: "Подтвердите, что вы не робот.",
      rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
      unavailable:
        "Не удалось выполнить проверку. Проверьте подключение к интернету и попробуйте ещё раз.",
    },
    fields: {
      email: {
        required: "Введите рабочую почту — на неё придёт код подтверждения.",
        invalid: "Проверьте адрес: он должен быть вида doctor@clinic.ru.",
      },
      password: {
        required: `Придумайте пароль не короче ${PASSWORD_MIN_LENGTH} символов.`,
        // 003 EARS-37 (owner decision Б) — the error RESTATES the rule the hint
        // states, because the shared slot shows one or the other, never both.
        invalid: `Пароль слишком короткий — нужно не менее ${PASSWORD_MIN_LENGTH} символов.`,
      },
      promoCode: {
        invalid: `Промокод длиннее ${PROMO_CODE_MAX_LENGTH} символов — проверьте, что скопировали только код.`,
      },
      code: { invalid: "Введите код из письма." },
    },
  },
  botProtection: {
    // The prod key is the `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` build arg
    // (`apps/doctor/Dockerfile`); `new.doctor.school` must be an allowed domain
    // of the SmartCaptcha resource for the challenge to run there.
    siteKey: process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY,
  },
  // Sign-in codes go to email only here; the identifier box therefore refuses a
  // phone shape rather than promising a journey this storefront does not run.
  channels: ["email"],
  register: { promoField: true },
} satisfies AuthFlowHostConfig;
