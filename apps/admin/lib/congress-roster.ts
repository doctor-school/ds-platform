import {
  CONGRESS_ROSTER_SORT_DEFAULT,
  CongressRosterSortDirSchema,
  CongressRosterSortKeySchema,
  type CongressRosterRow,
  type CongressRosterSortDir,
  type CongressRosterSortKey,
} from "@ds/schemas";
import { formatMskDateTime } from "./msk";

/**
 * 044 EARS-21/37 — the pure projection behind the congress roster screen
 * (`app/events/[id]/roster/page.tsx`). The page is a thin `AdminDataList` mount;
 * what it shows per row is decided here, so the Node-only unit tier can pin it.
 *
 * The columns follow EARS-37 exactly: №, ФИО, специальность, город, телефон,
 * дата регистрации, присутствие. Workplace, region, email and the mail status
 * left the table for the participant card (EARS-36, `./participant-card.ts`).
 * № is a row COUNTER over the server's paging, not a stored value: it carries
 * no sort and no filter.
 */
export const CONGRESS_ROSTER_COLUMNS = [
  "number",
  "fullName",
  "specialtyName",
  "city",
  "phone",
  "registeredAt",
  // 044 EARS-34 — one presence box per congress day.
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
): CongressRosterCells {
  return {
    fullName: row.fullName,
    specialtyName: row.specialtyName ?? "",
    city: row.city ?? "",
    phone: row.phone ?? "",
    registeredAt: formatMskDateTime(row.registeredAt),
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

/**
 * 044 EARS-22/EARS-37 — the one active server sort. It lives in the ADDRESS
 * (`?sort=&dir=`) so a sorted roster can be linked and survives a reload; the
 * search, paging and presence filter keep their component state.
 */
export interface RosterSort {
  key: CongressRosterSortKey;
  direction: CongressRosterSortDir;
}

export const ROSTER_SORT_PARAM = "sort";
export const ROSTER_DIR_PARAM = "dir";

export const ROSTER_SORT_DEFAULT: RosterSort = {
  key: CONGRESS_ROSTER_SORT_DEFAULT.sort,
  direction: CONGRESS_ROSTER_SORT_DEFAULT.dir,
};

/**
 * The route's sort key a visible column carries (EARS-37): № none, and
 * «Присутствие» only while a congress day is chosen — its order is that day's mark.
 */
export function rosterSortKeyOf(
  column: CongressRosterColumn,
  attendanceDay: string,
): CongressRosterSortKey | undefined {
  switch (column) {
    case "fullName":
    case "city":
    case "phone":
    case "registeredAt":
      return column;
    case "specialtyName":
      return "specialty";
    case "attendance":
      return attendanceDay ? "presence" : undefined;
    case "number":
      return undefined;
  }
}

/**
 * The sort the address asks for; anything the route would refuse — an unknown
 * key or direction, or `presence` without a chosen day — reads as the default.
 */
export function rosterSortFromAddress(
  params: URLSearchParams,
  attendanceDay: string,
): RosterSort {
  const key = CongressRosterSortKeySchema.safeParse(
    params.get(ROSTER_SORT_PARAM),
  );
  const direction = CongressRosterSortDirSchema.safeParse(
    params.get(ROSTER_DIR_PARAM) ?? ROSTER_SORT_DEFAULT.direction,
  );
  if (!key.success || !direction.success) return ROSTER_SORT_DEFAULT;
  if (key.data === "presence" && !attendanceDay) return ROSTER_SORT_DEFAULT;
  return { key: key.data, direction: direction.data };
}

/** The address with `sort` written in, the rest of the query (card, search) kept. */
export function rosterSortHref(
  pathname: string,
  search: string,
  sort: { key: string; direction: CongressRosterSortDir },
): string {
  const params = new URLSearchParams(search);
  params.set(ROSTER_SORT_PARAM, sort.key);
  params.set(ROSTER_DIR_PARAM, sort.direction);
  return `${pathname}?${params.toString()}`;
}

/** The GET params the sort owes the roster route. */
export function rosterSortQuery(sort: RosterSort): {
  sort: CongressRosterSortKey;
  dir: CongressRosterSortDir;
} {
  return { sort: sort.key, dir: sort.direction };
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

/**
 * 044 EARS-35 — what a refused desk entry means to the registrar. The desk
 * route re-validates the principal against the IdP on every call (ADR-0001 A1,
 * `revalidate: "live"`), so two refusals are about the GRANT, not the entry:
 *
 *  - `grantWithdrawn` — a 403 naming the missing registrar / administrator
 *    grant, or `EVENT_BINDING_REQUIRED` (the event binding was withdrawn or
 *    re-pointed, EARS-38): the grant is gone since the page loaded. The screen stops
 *    offering the roster (the shell's own refusal); a retry would only be
 *    refused again, so none is offered.
 *  - `revalidationUnavailable` — a 503 while the IdP could not be asked: the
 *    grant is unknown, not refused, so a retry is legitimate and the form keeps
 *    what the registrar typed.
 *
 * `noConsent` is the server's own refusal of the missing paper-consent tick (the
 * client refuses it first; this is the belt for a request that got through).
 * Everything else — unknown event (404), event not open (422), a network fault
 * — is the generic refusal, with the typed values kept.
 */
export type DeskEntryFailure =
  "grantWithdrawn" | "revalidationUnavailable" | "noConsent" | "generic";

const GRANT_REFUSAL_CODES = new Set([
  "EVENT_REGISTRAR_REQUIRED",
  "PLATFORM_ADMIN_REQUIRED",
  "EVENT_BINDING_REQUIRED",
]);

export function deskEntryFailure(error: unknown): DeskEntryFailure {
  const { statusCode, errorCode, fieldErrors } = (error ?? {}) as {
    statusCode?: number;
    errorCode?: string;
    fieldErrors?: { path: string; message: string }[];
  };
  if (statusCode === 403 && errorCode && GRANT_REFUSAL_CODES.has(errorCode)) {
    return "grantWithdrawn";
  }
  if (statusCode === 503 && errorCode === "IDP_REVALIDATION_UNAVAILABLE") {
    return "revalidationUnavailable";
  }
  if (
    statusCode === 400 &&
    fieldErrors?.some((issue) => issue.path === "paperConsent")
  ) {
    return "noConsent";
  }
  return "generic";
}
