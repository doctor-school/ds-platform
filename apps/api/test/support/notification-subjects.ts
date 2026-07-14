/**
 * Localized Zitadel notification-email subjects — the single place the live
 * (`skipIf`-gated) auth e2e specs select a delivered Mailpit message by subject.
 *
 * SoT: Zitadel's `ru` message-text templates. #177 locked the dev-stand IdP to
 * Russian (instance default language `ru` + allowed-languages restricted to
 * `[ru]`), so every notification email now renders with its Russian subject.
 * The `verifyemail` subject is BRANDED by `infra/dev-stand/idp/provision.sh`
 * step 8.ter (#869 — the code-only verification email leads its subject with
 * the dynamic `{{.Code}}`, e.g. `GX5AVU — код подтверждения Doctor.School`),
 * so the constant below is the STABLE SUBSTRING after the code and callers
 * match by `includes`, never equality. The `verifyemailotp` subject stays the
 * bundled `ru` default, observed live in Mailpit on the provisioned dev-stand.
 *
 *   - registration verify-email (`verifyemail`)  → "<code> — код подтверждения Doctor.School"
 *   - login email-OTP           (`verifyemailotp`) → "Проверка OTP"
 *
 * Keep these in one place: a future locale change (or a re-brand of the subjects
 * in provision.sh) updates exactly one constant instead of N hardcoded literals
 * scattered across specs. The English literals these replaced (`"Verify email"` /
 * `"Verify OTP"`, from #173/#131) were stale post-#177 and matched nothing live,
 * silently masking the real EARS-6 signal (#305).
 */
export const NOTIFICATION_SUBJECTS = {
  /**
   * Registration / email-verification mail (`verifyemail` template, branded
   * `ru`, #869). Stable substring — the rendered subject leads with the code.
   */
  verifyEmail: "код подтверждения Doctor.School",
  /** Login email-OTP mail (`verifyemailotp` template, `ru`). */
  verifyEmailOtp: "Проверка OTP",
} as const;
