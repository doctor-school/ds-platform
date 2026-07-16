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

/** A composed mail artifact ready for the SMTP transport. */
export interface CodeEmailMessage {
  subject: string;
  text: string;
  html: string;
}

/**
 * Stable subject tails (after the leading code + em-dash). The api/portal e2e
 * `NOTIFICATION_SUBJECTS` constants mirror these — one place per runtime.
 */
export const CODE_EMAIL_SUBJECT_TAILS = {
  /** §13.3 — registration / email-verification mail (EARS-1/3/25). */
  verifyEmail: "код подтверждения Doctor.School",
  /** §13.4 — password-reset mail (EARS-11). */
  passwordReset: "код сброса пароля Doctor.School",
} as const;

/** Shared copy blocks the two artifacts differ on. */
interface CodeEmailCopy {
  subjectTail: string;
  preheader: string;
  /** Line introducing the token («Ваш код …:»). */
  intro: string;
  /** Where to type it («Введите его на странице …»). */
  instruction: string;
  /** The not-you closer («Если вы не … — проигнорируйте это письмо»). */
  ignoreLine: string;
}

const VERIFY_COPY: CodeEmailCopy = {
  subjectTail: CODE_EMAIL_SUBJECT_TAILS.verifyEmail,
  preheader: "Введите код на странице подтверждения Doctor.School",
  intro: "Ваш код подтверждения:",
  instruction: "Введите его на странице подтверждения Doctor.School.",
  ignoreLine:
    "Если вы не регистрировались на Doctor.School — проигнорируйте это письмо.",
};

const RESET_COPY: CodeEmailCopy = {
  subjectTail: CODE_EMAIL_SUBJECT_TAILS.passwordReset,
  preheader: "Введите код на странице сброса пароля Doctor.School",
  intro: "Ваш код сброса пароля:",
  instruction: "Введите его на странице сброса пароля Doctor.School.",
  ignoreLine:
    "Если вы не запрашивали сброс пароля — проигнорируйте это письмо.",
};

/** «Код действует 1 час» — the 3600 s code-generator lifetime (design §14.1). */
const EXPIRY_LINE = "Код действует 1 час.";

function compose(code: string, copy: CodeEmailCopy): CodeEmailMessage {
  // Subject: the code LEADS (`GX5AVU — код подтверждения Doctor.School`),
  // rendered ~40 chars (< 50) so the inbox list / notification preview shows it.
  const subject = `${code} — ${copy.subjectTail}`;

  const text = [
    "Здравствуйте!",
    "",
    `${copy.intro} ${code}`,
    "",
    copy.instruction,
    EXPIRY_LINE,
    "",
    copy.ignoreLine,
  ].join("\n");

  // Inline-CSS/table markup (mail.ru/Yandex-safe). NO `<a>` element and NO URL
  // anywhere — the link-free invariant is structural, not a copy convention.
  // The token is ONE unbroken `<strong>` (enlarged + letter-spaced): the live
  // e2e pins `<strong>${code}</strong>` exactly.
  const html = [
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${copy.preheader}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">`,
    `<tr><td align="center" style="padding:32px 16px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;">`,
    `<tr><td style="padding:32px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#2d84f2;">Doctor.School</td></tr>`,
    `<tr><td style="padding:24px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;">Здравствуйте!</td></tr>`,
    `<tr><td style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;">${copy.intro}</td></tr>`,
    `<tr><td align="center" style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:32px;letter-spacing:6px;color:#111827;"><strong>${code}</strong></td></tr>`,
    `<tr><td style="padding:16px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;">${copy.instruction} ${EXPIRY_LINE}</td></tr>`,
    `<tr><td style="padding:24px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;">${copy.ignoreLine}</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
  ].join("\n");

  return { subject, text, html };
}

/** §13.3: the registration / resend email-verification artifact (EARS-1/3/25). */
export function verificationCodeEmail(code: string): CodeEmailMessage {
  return compose(code, VERIFY_COPY);
}

/** §13.4: the password-reset artifact (EARS-11). */
export function passwordResetCodeEmail(code: string): CodeEmailMessage {
  return compose(code, RESET_COPY);
}
