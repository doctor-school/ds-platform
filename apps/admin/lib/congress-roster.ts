import type { CongressRosterRow } from "@ds/schemas";
import { formatMskDateTime } from "./msk";

/**
 * 044 EARS-21/25 — the pure projection behind the congress roster screen
 * (`app/events/[id]/roster/page.tsx`). The page is a thin `AdminDataList` mount;
 * what it shows per row is decided here, so the Node-only unit tier can pin it.
 *
 * The columns follow EARS-25 exactly. № is a row COUNTER over the server's
 * paging, not a stored value: it carries no sort and no filter.
 */
export const CONGRESS_ROSTER_COLUMNS = [
  "number",
  "fullName",
  "specialtyName",
  "workplace",
  "city",
  "region",
  "phone",
  "email",
  "registeredAt",
  "confirmationMailStatus",
  // 044 EARS-34 — one presence box per congress day. Appended LAST: the EARS-37
  // column order is its own handler (#2383).
  "attendance",
] as const;
export type CongressRosterColumn = (typeof CONGRESS_ROSTER_COLUMNS)[number];

/**
 * The text cells — every roster column except the № counter and the
 * per-day attendance boxes (a control, not a string).
 */
export type CongressRosterCells = Record<
  Exclude<CongressRosterColumn, "number" | "attendance">,
  string
>;

/** № for the `index`-th row of the given server page — continuous across pages. */
export function congressRosterRowNumber(
  coordinates: { page: number; pageSize: number },
  index: number,
): number {
  return (coordinates.page - 1) * coordinates.pageSize + index + 1;
}

/**
 * One row as display strings. Every answer-derived cell the read model returns
 * `null` for (EARS-16: a platform-origin registration carries no answers and the
 * profile has no value) renders EMPTY — the roster never invents a placeholder
 * the registrar could mistake for data.
 */
export function congressRosterCells(
  row: CongressRosterRow,
  mailStatusLabel: (status: "sent" | "failed") => string,
): CongressRosterCells {
  return {
    fullName: row.fullName,
    specialtyName: row.specialtyName ?? "",
    workplace: row.workplace ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    registeredAt: formatMskDateTime(row.registeredAt),
    confirmationMailStatus: row.confirmationMailStatus
      ? mailStatusLabel(row.confirmationMailStatus)
      : "",
  };
}

/**
 * 044 EARS-34 — a congress day is a calendar DATE (`YYYY-MM-DD`), not an
 * instant: it is labelled from its own parts, never shifted through a timezone.
 * The box shows the short «23.04»; its accessible name carries «23 апреля».
 */
export function congressDayShortLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}.${month}`;
}

export function congressDayLongLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

/** The roster's presence filter as the operator set it; `""` = not chosen. */
export interface AttendanceFilter {
  day: string;
  presence: "" | "marked" | "unmarked";
}

export const ATTENDANCE_FILTER_INITIAL: AttendanceFilter = {
  day: "",
  presence: "",
};

/**
 * The GET query the filter owes the server (EARS-34): a day alone narrows
 * nothing server-side but is carried; a presence is sent ONLY with its day —
 * the route refuses `present` without `attendanceDay`.
 */
export function attendanceFilterQuery(filter: AttendanceFilter): {
  attendanceDay?: string;
  present?: "marked" | "unmarked";
} {
  if (!filter.day) return {};
  return filter.presence
    ? { attendanceDay: filter.day, present: filter.presence }
    : { attendanceDay: filter.day };
}

/**
 * Why a mark was refused, from the PUT's HTTP status (EARS-34/38):
 * `forbidden` — the grant or session is gone (401/403): never retried, the page
 * re-reads its list and shows its own refusal; `unavailable` — the IdP
 * revalidation or the network is down (503 / no answer): retryable;
 * `failed` — anything else (unknown day, foreign registration, server error).
 */
export type AttendanceFailureKind = "forbidden" | "unavailable" | "failed";

export function attendanceFailureKind(status: number): AttendanceFailureKind {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 0 || status === 503) return "unavailable";
  return "failed";
}
