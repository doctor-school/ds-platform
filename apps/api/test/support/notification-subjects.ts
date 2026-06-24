/**
 * Localized Zitadel notification-email subjects — the single place the live
 * (`skipIf`-gated) auth e2e specs select a delivered Mailpit message by subject.
 *
 * SoT: Zitadel's `ru` message-text templates. #177 locked the dev-stand IdP to
 * Russian (instance default language `ru` + allowed-languages restricted to
 * `[ru]`), so every notification email now renders with its Russian subject.
 * `infra/dev-stand/idp/provision.sh` deliberately does NOT customize these
 * subjects (it only brands message *text* / the `verifysmsotp` copy, step 8/8.bis)
 * — they come straight from Zitadel's bundled `ru` i18n templates. The values
 * below are the exact rendered subjects observed live in Mailpit on the
 * provisioned dev-stand (`GET {MAILPIT}/api/v1/messages`):
 *
 *   - registration verify-email (`verifyemail`)  → "Подтверждение email"
 *   - login email-OTP           (`verifyemailotp`) → "Проверка OTP"
 *
 * Keep these in one place: a future locale change (or a re-brand of the subjects
 * in provision.sh) updates exactly one constant instead of N hardcoded literals
 * scattered across specs. The English literals these replaced (`"Verify email"` /
 * `"Verify OTP"`, from #173/#131) were stale post-#177 and matched nothing live,
 * silently masking the real EARS-6 signal (#305).
 */
export const NOTIFICATION_SUBJECTS = {
  /** Registration / email-verification mail (`verifyemail` template, `ru`). */
  verifyEmail: "Подтверждение email",
  /** Login email-OTP mail (`verifyemailotp` template, `ru`). */
  verifyEmailOtp: "Проверка OTP",
} as const;
