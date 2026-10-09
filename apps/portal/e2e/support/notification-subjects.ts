/**
 * Localized notification-email subjects — the single place the portal
 * real-Zitadel browser E2E selects a delivered Mailpit message by subject.
 *
 * One sender (003 design §13–§14): the BFF mailer (#910/#1045/#2145, EARS-29)
 * composes the registration verify-email, password-reset and login-code mails in
 * `apps/api/src/mailer/code-emails.ts` (`CODE_EMAIL_SUBJECT_TAILS` is the SSOT
 * these constants mirror) — Zitadel sends nothing for those types (`returnCode`).
 *
 * Every branded subject LEADS with the dynamic code (`482913 — код
 * подтверждения Doctor.School`), so the constants below are the STABLE
 * SUBSTRING after the code and callers match by `includes`, never equality.
 * Mirrors the api-side `apps/api/test/support/notification-subjects.ts`.
 */
export const NOTIFICATION_SUBJECTS = {
  /**
   * Registration / email-verification mail (BFF `code-emails.ts`, §13.3,
   * EARS-1/3/25). Stable substring — the rendered subject leads with the code.
   */
  verifyEmail: "код подтверждения Doctor.School",
  /**
   * Password-reset mail (BFF `code-emails.ts`, §13.4, EARS-11). Stable
   * substring — the rendered subject leads with the code.
   */
  passwordReset: "код сброса пароля Doctor.School",
  /**
   * Login-code mail (BFF `code-emails.ts`, §13.5, EARS-6/34). Stable
   * substring — the subject leads with the code.
   */
  verifyEmailOtp: "код для входа в Doctor.School",
} as const;
