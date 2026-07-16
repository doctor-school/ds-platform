/**
 * Composed auth blocks (#235) — owned screen-scaffolds and the OTP focus-screen the
 * portal/admin/cms auth surfaces compose from. App-specific glue (BFF calls, EARS-16
 * errors, routing, i18n, captcha) is NEVER inside a block — these are presentation
 * scaffolds only. See the spec §3 (`tokens → primitives → blocks → app glue`).
 */
export { AuthLayout } from "./auth-layout";
export { AuthCard } from "./auth-card";
export { OtpFocusScreen } from "./otp-focus-screen";
export { useResendCountdown } from "./use-resend-countdown";
export { maskDestination } from "./mask-destination";

// 004 EARS-19 — month-calendar presentation blocks (webinars-month.dc.html).
export { MonthCalendarGrid } from "./month-calendar-grid";
export type {
  MonthCalendarGridProps,
  MonthGridCell,
  MonthGridPill,
} from "./month-calendar-grid";
export { MonthDotGrid } from "./month-dot-grid";
export type { MonthDotGridProps, DotGridCell, DotKind } from "./month-dot-grid";
export { DayAgenda } from "./day-agenda";
export type { DayAgendaProps, DayAgendaRow } from "./day-agenda";

// 004 EARS-16/17 — the 12-month picker (webinars-month.dc.html), #1051.
export { MonthPicker } from "./month-picker";
export type { MonthPickerProps, MonthPickerCell } from "./month-picker";
