/**
 * Localized notification-email subjects — the single place the live
 * (`skipIf`-gated) auth e2e specs select a delivered Mailpit message by subject.
 *
 * Two senders, one catalog (003 design §13):
 *
 * - **BFF mailer** (#910/#1045, EARS-29): the registration verify-email and the
 *   password-reset mails are composed by `apps/api/src/mailer/code-emails.ts`
 *   (`CODE_EMAIL_SUBJECT_TAILS` is the SSOT these constants mirror) — Zitadel
 *   sends nothing for those types (`returnCode`).
 * - **Zitadel `ru` message-text templates**: the login email-OTP
 *   (`verifyemailotp`, branded by `infra/dev-stand/idp/provision.sh` step
 *   8.quinquies, #878) stays IdP-sent. #177 locked the dev-stand IdP to
 *   Russian, so it renders with its Russian subject.
 *
 * Every branded subject LEADS with the dynamic code (`GX5AVU — код
 * подтверждения Doctor.School`), so the constants below are the STABLE
 * SUBSTRING after the code and callers match by `includes`, never equality.
 *
 *   - registration verify-email (BFF §13.3)   → "<code> — код подтверждения Doctor.School"
 *   - password reset            (BFF §13.4)   → "<code> — код сброса пароля Doctor.School"
 *   - login email-OTP           (`verifyemailotp`) → "<code> — код для входа в Doctor.School"
 *
 * Keep these in one place: a future locale change (or a re-brand of the
 * subjects) updates exactly one constant instead of N hardcoded literals
 * scattered across specs.
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
   * Login email-OTP mail (`verifyemailotp` template, branded `ru`, #878 —
   * still Zitadel-sent). Stable substring — the subject leads with the code.
   */
  verifyEmailOtp: "код для входа в Doctor.School",
} as const;
