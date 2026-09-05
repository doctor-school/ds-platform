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
// #1666 slice A — the ONE canonical sign-in composition both storefronts mount
// (AGENTS.md §6 cross-front reuse). Lifted verbatim from the portal `/login` page;
// copy, resolvers, transport, routing and the captcha element stay app glue.
export {
  LoginCard,
  LOGIN_OTP_LENGTH,
  LOGIN_RESEND_COOLDOWN_SECONDS,
} from "./login-card";
export type {
  LoginCardProps,
  LoginCardCopy,
  LoginCardPasswordProps,
  LoginCardPasswordValues,
  LoginCardOtpProps,
  LoginCardOtpChannel,
  LoginCardMethod,
  LoginCardOtpRequestValues,
  LoginCardOtpVerifyValues,
} from "./login-card";
// #1666 slice B — the ONE canonical password-recovery and email-confirmation
// compositions. Lifted verbatim from the portal `/reset` and `/verify` pages;
// copy, resolvers, transport, routing and the captcha element stay app glue.
export {
  PasswordRecoveryCard,
  PASSWORD_RECOVERY_OTP_LENGTH,
  PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS,
} from "./password-recovery-card";
export type {
  PasswordRecoveryCardProps,
  PasswordRecoveryCardCopy,
  PasswordRecoveryStage,
  PasswordRecoveryRequestProps,
  PasswordRecoveryRequestValues,
  PasswordRecoveryCompleteProps,
  PasswordRecoveryCompleteValues,
} from "./password-recovery-card";
export {
  EmailConfirmCard,
  EMAIL_CONFIRM_OTP_LENGTH,
  EMAIL_CONFIRM_RESEND_COOLDOWN_SECONDS,
} from "./email-confirm-card";
export type {
  EmailConfirmCardProps,
  EmailConfirmCardCopy,
  EmailConfirmResendProps,
  EmailConfirmValues,
} from "./email-confirm-card";

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
export type {
  MonthPickerProps,
  MonthPickerCell,
  MonthPickerYear,
} from "./month-picker";

// #1578 — the operator/admin block tier. Adopted from the whitelisted MIT
// registries (official shadcn/ui `Table` · `Pagination` · `Field` family ·
// `DataTableToolbar`; Kibo UI `combobox`) and re-skinned to DS tokens, so an
// admin screen composes blocks instead of hand-assembling tables and toolbars.
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./table";
export { DataTable } from "./data-table";
export type {
  DataTableProps,
  DataTableColumn,
  DataTableRecordColumn,
  DataTableAlign,
  DataTableOverflow,
} from "./data-table";
export {
  Pagination,
  buildPageItems,
  buildResponsivePageItems,
} from "./pagination";
export type { PaginationProps } from "./pagination";
export { EventList } from "./event-list";
export type {
  EventListProps,
  EventListItem,
  EventListLabels,
  EventListTab,
} from "./event-list";
export { EmptyState } from "./empty-state";
export type { EmptyStateProps, EmptyStateVariant } from "./empty-state";
export { FilterBar } from "./filter-bar";
export type {
  FilterBarProps,
  FilterBarApplyMode,
  AppliedFilter,
} from "./filter-bar";
// 019 EARS-7 — the ONE shared events facet panel (doctor-events.dc.html,
// F-019-1 Б sidebar); 019/030/031 mount it at different D-1 fill states and
// none of them owns a private copy.
export { EventsFilter } from "./events-filter";
export type {
  EventsFilterProps,
  EventsFilterFill,
  EventsFilterOption,
  EventsFilterOptions,
  EventsFilterLabels,
  AppliedFacets,
  FacetPanelState,
  SpecialtyRef,
} from "./events-filter";
export { Combobox } from "./combobox";
export type { ComboboxProps, ComboboxOption } from "./combobox";
export {
  FormSection,
  FormFieldGroup,
  FormSeparator,
  FormActions,
  FormDerivedNote,
} from "./field-group";
export type {
  FormSectionProps,
  FormFieldGroupProps,
  FormActionsProps,
  FormDerivedNoteProps,
} from "./field-group";
// 020 EARS-1 — event-page composition (webinar-page-variant-a.dc.html), #1764
export {
  EventPageHero,
  EventPageShell,
  EventSectionHeading,
} from "./event-page-shell";
export type {
  EventPageHeroProps,
  EventPageShellProps,
} from "./event-page-shell";
export { EventSignupCard } from "./event-signup-card";
export type {
  EventSignupCardProps,
  EventSignupCondition,
} from "./event-signup-card";
export { RecordingSpoiler } from "./recording-spoiler";
export type { RecordingSpoilerProps } from "./recording-spoiler";
export { EventSpeakerCard } from "./event-speaker-card";
export type { EventSpeakerCardProps } from "./event-speaker-card";
export { EventFormatBlock } from "./event-format-block";
export type { EventFormatBlockProps } from "./event-format-block";
// 020 EARS-2 — the shared left-flow sections + the link-aware hero kicker
// (#1765). Both storefronts mounted hand-composed copies of these until this
// slice; they are one implementation now.
export {
  EventAboutSection,
  EventPageKicker,
  EventProgrammeSection,
} from "./event-left-flow";
export type {
  EventAboutSectionProps,
  EventPageKickerProps,
  EventProgrammeSectionProps,
} from "./event-left-flow";
// 020 EARS-1/EARS-18 — the ONE view→props projection both storefronts render
// through, so the two hosts cannot drift apart on the same event (slice 3, #1764).
export {
  EVENT_PAGE_COPY,
  eventFormatBlockProps,
  eventLifecycleCountdown,
  eventLifecyclePlate,
  eventPageChips,
  eventPageDateLine,
  eventPageKicker,
  eventPageKickerParts,
  eventPageTimeParts,
  eventProgrammeContent,
  eventSignupCardProps,
  eventSpeakerCards,
} from "./event-page-view";
export type {
  EventLifecyclePlate,
  EventPageCopy,
  EventPageKickerParts,
  EventPageTimeParts,
  EventProgrammeContent,
} from "./event-page-view";
