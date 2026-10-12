import {
  CONGRESS_ROSTER_SEARCH_MAX,
  CONGRESS_ROSTER_SORT_DEFAULT,
  CongressRosterMailStatusFilterSchema,
  type CongressRosterMailStatusFilter,
  CongressRosterSortDirSchema,
  CongressRosterSortKeySchema,
  type CongressRosterRow,
  type CongressRosterSortDir,
  type CongressRosterSortKey,
  formatContactPhone,
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
    // EARS-36: one display format, built from the normalised value.
    phone: formatContactPhone(row.phone ?? ""),
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

/**
 * The address carries a sort the screen does not honour — `presence` with no
 * day chosen (the day is not in the address, so a reload drops it), or an
 * unknown key / direction. The screen rewrites it to the default so the
 * address never holds a stale sort that would come back to life later.
 */
export function rosterSortAddressIsStale(
  params: URLSearchParams,
  attendanceDay: string,
): boolean {
  const key = params.get(ROSTER_SORT_PARAM);
  const direction = params.get(ROSTER_DIR_PARAM);
  if (key === null && direction === null) return false;
  const honoured = rosterSortFromAddress(params, attendanceDay);
  return (
    honoured.key !== key ||
    honoured.direction !== (direction ?? ROSTER_SORT_DEFAULT.direction)
  );
}

/** The roster's own order — registration date, oldest first. */
export function isRosterSortDefault(sort: {
  key: string;
  direction: string;
}): boolean {
  return (
    sort.key === ROSTER_SORT_DEFAULT.key &&
    sort.direction === ROSTER_SORT_DEFAULT.direction
  );
}

/**
 * The address with `sort` written in, the rest of the query (card, search) kept;
 * the default order (the header's «Сбросить сортировку») takes it out instead.
 */
export function rosterSortHref(
  pathname: string,
  search: string,
  sort: { key: string; direction: CongressRosterSortDir },
): string {
  const params = new URLSearchParams(search);
  if (isRosterSortDefault(sort)) {
    params.delete(ROSTER_SORT_PARAM);
    params.delete(ROSTER_DIR_PARAM);
  } else {
    params.set(ROSTER_SORT_PARAM, sort.key);
    params.set(ROSTER_DIR_PARAM, sort.direction);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The GET params the sort owes the roster route. */
export function rosterSortQuery(sort: RosterSort): {
  sort: CongressRosterSortKey;
  dir: CongressRosterSortDir;
} {
  return { sort: sort.key, dir: sort.direction };
}

/**
 * 044 EARS-23 — the per-column filters (owner layout F1, #2316). They live in
 * the ADDRESS under the route's own param names, so a filtered roster is
 * linkable and survives a reload; `""` = not applied.
 */
export const ROSTER_FILTER_KEYS = [
  "name",
  "workplace",
  "city",
  "region",
  "phone",
  "email",
  "specialtyId",
  "mailStatus",
  "registeredFrom",
  "registeredTo",
] as const;
export type RosterFilterKey = (typeof ROSTER_FILTER_KEYS)[number];

export type RosterColumnFilters = Record<
  Exclude<RosterFilterKey, "mailStatus">,
  string
> & { mailStatus: CongressRosterMailStatusFilter | "" };

export const ROSTER_FILTERS_EMPTY: RosterColumnFilters = {
  name: "",
  workplace: "",
  city: "",
  region: "",
  phone: "",
  email: "",
  specialtyId: "",
  mailStatus: "",
  registeredFrom: "",
  registeredTo: "",
};

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real `YYYY-MM-DD` calendar day — `2026-02-31` and `2026-13-01` are not. */
function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * The registration range the route accepts: a «по» before the «с» is dropped
 * (the «с» kept), so an inverted range never reaches the route's 400.
 */
function validRange(from: string, to: string): [string, string] {
  return [from, from && to && from > to ? "" : to];
}

/**
 * The filters the address asks for. A value the route would refuse is DROPPED
 * — read as not applied, never sent to become a 400 page: an unknown mail
 * status, a malformed id, an impossible or malformed day, text over the
 * route's {@link CONGRESS_ROSTER_SEARCH_MAX}, a phone with no digit, and the
 * «по» of an inverted range.
 */
export function rosterFiltersFromAddress(
  params: URLSearchParams,
): RosterColumnFilters {
  const read = (key: RosterFilterKey) => (params.get(key) ?? "").trim();
  const text = (key: RosterFilterKey) => {
    const value = read(key);
    return value.length > CONGRESS_ROSTER_SEARCH_MAX ? "" : value;
  };
  const mail = CongressRosterMailStatusFilterSchema.safeParse(
    read("mailStatus"),
  );
  const day = (key: RosterFilterKey) =>
    isCalendarDay(read(key)) ? read(key) : "";
  const phone = text("phone");
  const [registeredFrom, registeredTo] = validRange(
    day("registeredFrom"),
    day("registeredTo"),
  );
  return {
    name: text("name"),
    workplace: text("workplace"),
    city: text("city"),
    region: text("region"),
    phone: /\d/.test(phone) ? phone : "",
    email: text("email"),
    specialtyId: UUID.test(read("specialtyId")) ? read("specialtyId") : "",
    mailStatus: mail.success ? mail.data : "",
    registeredFrom,
    registeredTo,
  };
}

/** The address with `filters` written in (blanks removed), the rest of the query kept. */
export function rosterFiltersHref(
  pathname: string,
  search: string,
  filters: RosterColumnFilters,
): string {
  const params = new URLSearchParams(search);
  for (const key of ROSTER_FILTER_KEYS) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The registration range the route accepts ({@link validRange}). */
function orderedRange(filters: RosterColumnFilters): [string, string] {
  return validRange(filters.registeredFrom, filters.registeredTo);
}

/** Whether a filter narrows anything — a phone term needs a digit (the route refuses one without). */
function isApplied(filters: RosterColumnFilters, key: RosterFilterKey): boolean {
  const value = filters[key].trim();
  if (!value) return false;
  return key === "phone" ? /\d/.test(value) : true;
}

/** The GET params the applied filters owe the roster route. */
export function rosterFiltersQuery(
  filters: RosterColumnFilters,
): Partial<Record<RosterFilterKey, string>> {
  const [from, to] = orderedRange(filters);
  const ordered = { ...filters, registeredFrom: from, registeredTo: to };
  const query: Partial<Record<RosterFilterKey, string>> = {};
  for (const key of ROSTER_FILTER_KEYS) {
    if (isApplied(ordered, key)) query[key] = ordered[key].trim();
  }
  return query;
}

/** The «Все фильтры» badge: applied filters, the date range counted once. */
export function rosterFiltersAppliedCount(filters: RosterColumnFilters): number {
  const single = ROSTER_FILTER_KEYS.filter(
    (key) =>
      key !== "registeredFrom" &&
      key !== "registeredTo" &&
      isApplied(filters, key),
  ).length;
  return single + (rosterRegisteredRange(filters) ? 1 : 0);
}

/** A `YYYY-MM-DD` Moscow day as «01.10.2026» — a calendar date, never shifted. */
export function formatRosterDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

/** The registration-range chip's two ends, ordered and formatted; `""` = open end. */
export function rosterRegisteredRange(
  filters: RosterColumnFilters,
): { from: string; to: string } | null {
  const [from, to] = orderedRange(filters);
  if (!from && !to) return null;
  return {
    from: from ? formatRosterDay(from) : "",
    to: to ? formatRosterDay(to) : "",
  };
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
