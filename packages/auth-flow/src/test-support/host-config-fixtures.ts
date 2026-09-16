import type { AuthFlowHostConfig } from "../host-config";

/**
 * The two host shapes the package units are exercised against (#2027).
 *
 * Fixtures, not the hosts' own configs: a package may not import from an app
 * (ADR-0013 A1), and the point of every case below is the BRANCH the package
 * owns, never the sentence a host chose. The sentences here therefore mirror the
 * shipped ones only closely enough that an assertion can tell two branches apart.
 */

/** The Academy: an email-or-SMS host whose registration form has no promo box. */
export const ACADEMY_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/auth/register",
    confirmPath: "/v1/auth/verify",
  },
  copy: {
    errors: {
      tooManyAttempts: "Слишком много попыток — повторите через несколько минут.",
      unavailable: "Сервис временно недоступен — попробуйте ещё раз.",
      botProtectionRequired: "Подтвердите, что вы не робот.",
      botProtectionRejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
    },
    botProtection: {
      required: "Подтвердите, что вы не робот.",
      rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
      unavailable: "Не удалось выполнить проверку.",
    },
    fields: {
      email: { required: "Заполните это поле.", invalid: "Введите корректный адрес электронной почты." },
      password: { required: "Заполните это поле.", invalid: "Не менее 8 символов." },
      code: { required: "Введите код.", invalid: "Введите код." },
    },
  },
  botProtection: { siteKey: undefined },
  channels: ["email", "sms"],
  register: { promoField: false },
};

/** The doctor storefront: email-only sign-in codes, promo box on the form. */
export const DOCTOR_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/storefront/doctor/register",
    confirmPath: "/v1/storefront/doctor/confirm",
  },
  copy: {
    errors: {
      tooManyAttempts: "Слишком много попыток. Подождите пару минут и попробуйте снова.",
      unavailable: "Сервис временно недоступен. Попробуйте ещё раз через минуту.",
      botProtectionRequired: "Нужна дополнительная проверка. Подтвердите, что вы не робот.",
      botProtectionRejected: "Нужна дополнительная проверка — она истекла или не пройдена.",
    },
    botProtection: {
      required: "Подтвердите, что вы не робот.",
      rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
      unavailable: "Не удалось выполнить проверку.",
    },
    fields: {
      email: {
        required: "Введите рабочую почту — на неё придёт код подтверждения.",
        invalid: "Проверьте адрес: он должен быть вида doctor@clinic.ru.",
      },
      password: {
        required: "Придумайте пароль не короче 8 символов.",
        invalid: "Пароль слишком короткий — нужно не менее 8 символов.",
      },
      promoCode: { invalid: "Промокод длиннее 64 символов — проверьте, что скопировали только код." },
      code: { invalid: "Введите код из письма." },
    },
  },
  botProtection: { siteKey: undefined },
  channels: ["email"],
  register: { promoField: true },
};
