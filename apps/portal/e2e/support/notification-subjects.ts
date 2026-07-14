/**
 * Localized Zitadel notification-email subjects — the single place the portal
 * real-Zitadel browser E2E selects a delivered Mailpit message by subject.
 *
 * SoT: Zitadel's `ru` message-text templates. #177 locked the dev-stand IdP to
 * Russian (instance default language `ru` + allowed-languages restricted to
 * `[ru]`), so every notification email now renders with its Russian subject.
 * The `verifyemail` subject is BRANDED by `infra/dev-stand/idp/provision.sh`
 * step 8.ter (#869 — the code-only verification email leads its subject with
 * the dynamic `{{.Code}}`, e.g. `GX5AVU — код подтверждения Doctor.School`),
 * and the `verifyemailotp` subject is branded the same way by step 8.quinquies
 * (#878 — leads with the dynamic `{{.OTP}}`), so the constants below are the
 * STABLE SUBSTRING after the code and callers match by `includes`, never
 * equality.
 *
 *   - registration verify-email (`verifyemail`)  → "<code> — код подтверждения Doctor.School"
 *   - login email-OTP           (`verifyemailotp`) → "<code> — код для входа в Doctor.School"
 *
 * Keep these in one place: a future locale change (or a re-brand of the subjects
 * in provision.sh) updates exactly one constant instead of N hardcoded literals.
 * The English literals these replaced (`"Verify email"` / `"Verify OTP"`, from
 * #173/#131) were stale post-#177 and matched nothing live (#305). Mirrors the
 * api-side `apps/api/test/support/notification-subjects.ts`.
 */
export const NOTIFICATION_SUBJECTS = {
  /**
   * Registration / email-verification mail (`verifyemail` template, branded
   * `ru`, #869). Stable substring — the rendered subject leads with the code.
   */
  verifyEmail: "код подтверждения Doctor.School",
  /**
   * Login email-OTP mail (`verifyemailotp` template, branded `ru`, #878).
   * Stable substring — the rendered subject leads with the code.
   */
  verifyEmailOtp: "код для входа в Doctor.School",
} as const;
