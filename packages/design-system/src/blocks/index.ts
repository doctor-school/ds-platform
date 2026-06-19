/**
 * Composed auth blocks (#235) — owned screen-scaffolds and the OTP focus-screen the
 * portal/admin/cms auth surfaces compose from. App-specific glue (BFF calls, EARS-16
 * errors, routing, i18n, captcha) is NEVER inside a block — these are presentation
 * scaffolds only. See the spec §3 (`tokens → primitives → blocks → app glue`).
 */
export { AuthLayout } from "./auth-layout";
export { AuthCard } from "./auth-card";
export { OtpFocusScreen } from "./otp-focus-screen";
export { maskDestination } from "./mask-destination";
