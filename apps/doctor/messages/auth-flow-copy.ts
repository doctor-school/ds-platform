import { PASSWORD_MIN_LENGTH, PROMO_CODE_MAX_LENGTH } from "@ds/schemas";

import type { AuthFlowCopy } from "@ds/auth-flow/host-config";

/**
 * Every RU sentence the doctor storefront's auth screens can show (#2027, epic
 * #2020 wave 1).
 *
 * A file of its OWN, under `messages/` rather than `lib/`, because copy is
 * rendered UI
 * and the repo's UI guards classify app-owned `.ts` by the filename contract in
 * `tools/lint/lib/ui-surface.ts` (`*-copy.ts`, `*-theme.ts`, …). Keeping these
 * sentences inside the transport/channels value file would hide a render delta
 * from ui-parity; keeping the value file free of copy keeps both halves honest.
 * The Academy states the same sentences through next-intl `messages/*.json`,
 * which that contract already recognises — this storefront ships no i18n
 * runtime, so its sentences are literals here.
 *
 * This file re-homes what the storefront already shipped; it rewords nothing.
 */
export const DOCTOR_AUTH_FLOW_COPY: AuthFlowCopy = {
  errors: {
    tooManyAttempts:
      "Слишком много попыток. Подождите пару минут и попробуйте снова.",
    unavailable: "Сервис временно недоступен. Попробуйте ещё раз через минуту.",
    // Registration (`registration-screen.tsx`) and recovery (`reset-screen.tsx`)
    // DO render the challenge: both intercept the two bot-protection codes ahead
    // of the dictionary and show `botProtection.*` beside the widget. These two
    // sentences are therefore reached only from the login / OTP-request surface,
    // which still has no slot (the sign-in door of `@ds/auth-flow/login` has «NO BOT-PROTECTION SLOT»), so
    // they name the way forward rather than blaming a password. Wave-1 PR 1.6 of
    // the OPEN #2027 owns that slot; once it lands, these two lose their last
    // caller.
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
    identifier: {
      required: "Введите почту или телефон.",
      invalid:
        "Проверьте: почта вида doctor@clinic.ru или телефон в формате +79991234567.",
    },
    phone: {
      required: "Введите почту или телефон.",
      invalid: "Проверьте номер: он должен быть в формате +79991234567.",
    },
  },
  login: {
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
      passwordRequired: "Введите пароль.",
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
      sentTo: "Код отправлен на {destination}",
      codeLabel: "Код из сообщения",
      codeInvalid: "Код состоит из 8 цифр — проверьте, что ввели все.",
      verifySubmit: "Войти",
      resend: "Прислать код ещё раз",
      resendCountdown: "Отправить снова можно через {seconds} с",
      changeMethod: "Другой способ входа",
    },
    // The per-ACTION generic each login call passes to the dictionary (row 11).
    failed: {
      password: "Не удалось войти. Проверьте почту или телефон и пароль.",
      otpRequest: "Не удалось отправить код. Проверьте адрес или номер и повторите.",
      otpVerify: "Код не подошёл. Проверьте цифры или запросите новый.",
    },
  },
  // Row 46 — one eyebrow; the door forks only the line (#1955).
  returnContext: {
    eyebrow: "Вы вернётесь к этому событию",
    login: "После входа вы вернётесь сюда же — место за вами.",
    register: "После подтверждения почты вы вернётесь сюда же — место за вами.",
  },
  // Row 47 — the brand panel, verbatim from `design-source/auth.dc.html`. The
  // canvas's «… врачей 38 школ.» count has no source in the read model and is
  // dropped, not zeroed (the 017 precedent).
  brand: {
    eyebrow: "Врачи учат врачей",
    headline: "Учитесь у практикующих врачей",
    subcopy: "Бесплатные эфиры, записи и сертификаты НМО — от практикующих врачей.",
    footer: "Бесплатно для врача · без бюрократии · © Doctor.School 2026",
  },
  // 003 EARS-17 — the SmartCaptcha processing notice; the same sentences the
  // Academy shows, because it is the same vendor notice. Rendered wherever the
  // challenge can run (gate Q-C: the doctor door converges onto the challenge).
  botProtectionDisclosure: {
    notice: "Форма защищена Yandex SmartCaptcha.",
    link: "Условия обработки данных.",
    linkLabel: "Условия обработки данных Yandex SmartCaptcha (откроются в новой вкладке)",
  },
};

/**
 * The per-ACTION generic each login call passes to `authErrorMessage` (wave-1
 * gate row 11).
 *
 * The dictionary deliberately carries no generic of its own, so that a failed
 * code verification never says «войти». The caller names the action, and these
 * are the three actions the login screen runs.
 */
export const DOCTOR_LOGIN_FALLBACK_COPY = {
  password: "Не удалось войти. Проверьте почту или телефон и пароль.",
  otpRequest: "Не удалось отправить код. Проверьте адрес или номер и повторите.",
  otpVerify: "Код не подошёл. Проверьте цифры или запросите новый.",
} as const;
