/**
 * The shared event-storefront unit's MODEL entry: the completion-on-return
 * decision rule (005 EARS-2) that both storefronts project through their own
 * {@link ReturnHost}.
 *
 * The browser transport that carries the command itself (`registerForEvent`,
 * `RegistrationError`) is the `./client` entry, the progressive-enhancement
 * control is `./ui`, and the server-side read plus the no-JS form action are
 * `./server` — one entry per layer, so a host (and a host's test) can address
 * exactly the layer it projects.
 */
export {
  type ReturnHost,
  completeReturnTarget,
  currentReturnTarget,
} from "./client/registration-resume";

/**
 * The one event-time formatter (004 EARS-12 as amended) — its pure core lives in
 * `@ds/schemas` so the api and the admin import it directly; the storefronts
 * reach it here, beside `useViewerZone` (`./ui`) that supplies `viewerZone`.
 */
export {
  type EventTime,
  type EventTimeInput,
  MOSCOW_TIME_ZONE,
  formatEventTime,
} from "@ds/schemas";

/**
 * The storefront's pure model units (wave-2 entry gate §2.1, epic #2020): the МСК
 * projections of the one formatter, the month grid and its paging, the lifecycle
 * → canvas status vocabulary, the recording signal / plaque / player card, the
 * one past-card playability rule and the one event-count plural rule.
 */
export {
  type MskParts,
  formatMskDayLabel,
  formatMskMonth,
  formatMskParts,
  formatMskWeekdayShort,
  mskDayKey,
  mskMonthKey,
} from "./model/msk";
export {
  DAY_PILL_CAP,
  type MonthDayCell,
  type MonthGrid,
  buildMonthGrid,
  capDayEntries,
  currentMskMonth,
  formatAgendaDayTitle,
  formatMonthTitle,
  isMonthFuture,
  isMonthPast,
  monthShortLabels,
  mskDateParts,
  shiftMonth,
  weekdayShortLabels,
} from "./model/month-grid";
export { type CanvasStatus, toCanvasStatus } from "./model/event-lifecycle";
export {
  type PlayerCard,
  type RecordingPlaque,
  type RecordingSignal,
  formatReadinessDay,
  resolvePlayerCard,
  resolveRecordingPlaque,
  resolveRecordingSignal,
} from "./model/recording-signal";
export { isRecordingPlayable } from "./model/recording-cta";
export {
  DEFAULT_EVENT_NOUN,
  type PluralNoun,
  formatEventCount,
} from "./model/event-count";
