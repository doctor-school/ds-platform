import { PASSWORD_MIN_LENGTH, PROMO_CODE_MAX_LENGTH } from "@ds/schemas";

import type { AuthFlowCopy } from "@ds/auth-flow/host-config";

/**
 * Every RU sentence the doctor storefront's auth screens can show (#2027, epic
 * #2020 wave 1).
 *
 * A file of its OWN, next to `auth-flow-config.ts`, because copy is rendered UI
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
    // which still has no slot (`login-screen.tsx` «NO BOT-PROTECTION SLOT»), so
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
