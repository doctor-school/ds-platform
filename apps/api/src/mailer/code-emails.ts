/**
 * 003 EARS-29 (#910/#1045, design §13.3/§13.4): the BFF-composed one-time-code
 * email artifacts — branded, Russian, CODE-ONLY, **fully link-free** (the
 * owner-picked Notion/Slack style, decision 2026-07-15, #910).
 *
 * This module is the SSOT for the verify/reset mail copy the spec pins:
 * the code LEADS the subject (inbox-preview UX — many users never open the
 * mail), the body renders it as ONE unbroken, enlarged, letter-spaced token
 * (what is read is exactly what is typed), an explicit expiry line follows
 * (`VERIFY_EMAIL_CODE` / `PASSWORD_RESET_CODE` generator lifetime, 3600 s),
 * and the mail contains **zero `<a>` elements and zero URLs** — nothing a mail
 * scanner's GET prefetch (mail.ru `checklink`) can consume, by construction.
 *
 * Markup: inline-CSS tables only — the same mail.ru/Yandex constraints
 * Zitadel's bundled MJML template satisfied. Copy changes MUST preserve the
 * stable subject tails below (the e2e harnesses select by them, substring
 * match) or update `test/support/notification-subjects.ts` (+ the portal
 * mirror) in the same PR.
 */

import { composeEmail, type EmailMessage } from "./email-layout.js";

/** A composed code mail ready for the SMTP transport. */
export type CodeEmailMessage = EmailMessage;

/**
 * Stable subject tails (after the leading code + em-dash). The api/portal e2e
 * `NOTIFICATION_SUBJECTS` constants mirror these — one place per runtime.
 */
export const CODE_EMAIL_SUBJECT_TAILS = {
  /** §13.3 — registration / email-verification mail (EARS-1/3/25). */
  verifyEmail: "код подтверждения Doctor.School",
  /** §13.4 — password-reset mail (EARS-11). */
  passwordReset: "код сброса пароля Doctor.School",
  login: "код для входа в Doctor.School",
} as const;

/** Shared copy blocks the two artifacts differ on. */
interface CodeEmailCopy {
  subjectTail: string;
  preheader: string;
  /** Line introducing the token («Ваш код …:»). */
  intro: string;
  /** Where to type it («Введите код в уже открытой вкладке …»). */
  instruction: string;
  /** The not-you closer («Если вы не … — проигнорируйте это письмо»). */
  ignoreLine: string;
}

const VERIFY_COPY: CodeEmailCopy = {
  subjectTail: CODE_EMAIL_SUBJECT_TAILS.verifyEmail,
  preheader: "Введите код в уже открытой вкладке Doctor.School",
  intro: "Ваш код подтверждения:",
  instruction:
    "Введите код в уже открытой вкладке Doctor.School, где вы его запросили.",
  ignoreLine: "Если вы не запрашивали код — проигнорируйте это письмо.",
};

const RESET_COPY: CodeEmailCopy = {
  subjectTail: CODE_EMAIL_SUBJECT_TAILS.passwordReset,
  preheader: "Введите код в уже открытой вкладке Doctor.School",
  intro: "Ваш код сброса пароля:",
  instruction:
    "Введите код в уже открытой вкладке Doctor.School, где вы запросили сброс пароля.",
  ignoreLine:
    "Если вы не запрашивали сброс пароля — проигнорируйте это письмо.",
};

/*
 * The code lifetimes the emails state (design §13.5, §14.1). The IdP generators
 * hold the real lifetimes; the deploy's read-back (tools/deploy/idp-policy.mjs,
 * #2814) parses these declarations at the deployed SHA and refuses a generator
 * whose expiry differs, so each stays a plain integer literal in seconds.
 */
/** SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE lifetime, seconds. */
export const VERIFY_EMAIL_CODE_LIFETIME_SECONDS = 3600;
/** SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE lifetime, seconds. */
export const PASSWORD_RESET_CODE_LIFETIME_SECONDS = 3600;
/** SECRET_GENERATOR_TYPE_OTP_EMAIL (sign-in code) lifetime, seconds. */
export const LOGIN_EMAIL_CODE_LIFETIME_SECONDS = 300;

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «Код действует N …» for a lifetime in whole hours or minutes. */
export function codeLifetimeLine(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds % 60 !== 0) {
    throw new Error(
      `code lifetime ${seconds}s cannot be stated in whole minutes`,
    );
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `Код действует ${hours} ${pluralRu(hours, "час", "часа", "часов")}.`;
  }
  const minutes = seconds / 60;
  return `Код действует ${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}.`;
}

function compose(code: string, copy: CodeEmailCopy, expiry: string): CodeEmailMessage {
  return composeEmail({
    subject: `${code} — ${copy.subjectTail}`,
    preheader: copy.preheader,
    intro: copy.intro,
    code: { value: code, expiry },
    paragraphs: [copy.instruction],
    footer: [copy.ignoreLine],
  });
}

/** §13.3: the registration / resend email-verification artifact (EARS-1/3/25). */
export function verificationCodeEmail(code: string): CodeEmailMessage {
  return compose(
    code,
    VERIFY_COPY,
    codeLifetimeLine(VERIFY_EMAIL_CODE_LIFETIME_SECONDS),
  );
}

/** §13.4: the password-reset artifact (EARS-11). */
export function passwordResetCodeEmail(code: string): CodeEmailMessage {
  return compose(
    code,
    RESET_COPY,
    codeLifetimeLine(PASSWORD_RESET_CODE_LIFETIME_SECONDS),
  );
}

/**
 * The lifetime of the code a sign-in mail carries (design §13.5): the
 * `OTP_EMAIL` login code lives 300 s, the verification code an unverified
 * account receives in the same mail lives 3600 s.
 */
export type CodeLifetime = "5m" | "1h";

function expiryLine(lifetime: CodeLifetime): string {
  return codeLifetimeLine(
    lifetime === "5m"
      ? LOGIN_EMAIL_CODE_LIFETIME_SECONDS
      : VERIFY_EMAIL_CODE_LIFETIME_SECONDS,
  );
}

const LOGIN_COPY: CodeEmailCopy = {
  ...VERIFY_COPY,
  subjectTail: CODE_EMAIL_SUBJECT_TAILS.login,
  intro: "Ваш код для входа:",
};

/** 003 EARS-6/34: the sign-in code mail, for either code kind (design §13.5). */
export function loginCodeEmail(
  code: string,
  lifetime: CodeLifetime = "5m",
): CodeEmailMessage {
  return compose(code, LOGIN_COPY, expiryLine(lifetime));
}

/** What the re-registration mail says about the account's password. */
export interface ReRegistrationCopyInput {
  lifetime: CodeLifetime;
  /** True only for a verified account that holds a password (003 EARS-23). */
  passwordKept: boolean;
}

/**
 * 003 EARS-23: the re-registration mail — the code EARS-34 would issue, «already
 * registered» copy and the password line; no link (design §13.5).
 */
export function reRegistrationCodeEmail(
  code: string,
  input: ReRegistrationCopyInput,
): CodeEmailMessage {
  return composeEmail({
    subject: `${code} — ${CODE_EMAIL_SUBJECT_TAILS.login}`,
    preheader: "Этот адрес уже зарегистрирован в Doctor.School",
    intro:
      "Этот адрес уже зарегистрирован в Doctor.School. Ваш код для входа:",
    code: { value: code, expiry: expiryLine(input.lifetime) },
    paragraphs: [
      input.passwordKept
        ? "Ваш пароль не изменился."
        : "Пароль, который вы ввели при регистрации, сохранится после ввода кода.",
      LOGIN_COPY.instruction,
    ],
    footer: [LOGIN_COPY.ignoreLine],
  });
}
