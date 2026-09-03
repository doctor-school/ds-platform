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
export { EventPageHero, EventPageShell } from "./event-page-shell";
export type { EventPageHeroProps, EventPageShellProps } from "./event-page-shell";
export { EventSignupCard } from "./event-signup-card";
export type {
  EventSignupCardProps,
  EventSignupCondition,
} from "./event-signup-card";
export { EventSpeakerCard } from "./event-speaker-card";
export type { EventSpeakerCardProps } from "./event-speaker-card";
export { EventFormatBlock } from "./event-format-block";
export type { EventFormatBlockProps } from "./event-format-block";
