import {
  EVENT_ADMIN_LIST_SCREEN_SORT_DEFAULT,
  EventAdminListSortDirSchema,
  EventAdminListSortKeySchema,
  EventLifecycleStateSchema,
  type EventAdminListSortDir,
  type EventAdminListSortKey,
  type EventLifecycleState,
} from "@ds/schemas";

/**
 * 007 EARS-14 — the pure projection behind the admin event list
 * (`app/events/page.tsx`): the view the operator set — the one sort, the
 * search, the state, the Moscow-day start period and the page — read from and
 * written to the ADDRESS, so a reload or a shared link reopens the same view.
 * The page is a thin `AdminDataList` mount; what the address means is decided
 * here, so the Node-only unit tier can pin it.
 *
 * The address uses the route's own parameter names (`q`, `state`,
 * `startsFrom`, `startsTo`, `sort`, `dir`, `page`). The default order — newest
 * start date first ({@link EVENT_ADMIN_LIST_SCREEN_SORT_DEFAULT}) — is left out
 * of it, as is page 1, so the plain list is the bare `/events`.
 */
export interface EventsListSort {
  key: EventAdminListSortKey;
  direction: EventAdminListSortDir;
}

export interface EventsListView {
  q: string;
  state: EventLifecycleState | "";
  /** The first Moscow calendar day of the start period (`YYYY-MM-DD`); `""` = open. */
  startsFrom: string;
  /** The last Moscow calendar day of the start period (`YYYY-MM-DD`); `""` = open. */
  startsTo: string;
  sort: EventsListSort;
  page: number;
}

/** The route's `q` ceiling (`EventAdminListQuerySchema`). */
export const EVENTS_LIST_SEARCH_MAX = 160;

export const EVENTS_LIST_SORT_DEFAULT: EventsListSort = {
  key: EVENT_ADMIN_LIST_SCREEN_SORT_DEFAULT.sort,
  direction: EVENT_ADMIN_LIST_SCREEN_SORT_DEFAULT.dir,
};

export const EVENTS_LIST_VIEW_DEFAULT: EventsListView = {
  q: "",
  state: "",
  startsFrom: "",
  startsTo: "",
  sort: EVENTS_LIST_SORT_DEFAULT,
  page: 1,
};

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real `YYYY-MM-DD` calendar day — `2026-02-31` and `2026-13-01` are not. */
function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** The newest-first date order the list opens with. */
export function isEventsListSortDefault(sort: {
  key: string;
  direction: string;
}): boolean {
  return (
    sort.key === EVENTS_LIST_SORT_DEFAULT.key &&
    sort.direction === EVENTS_LIST_SORT_DEFAULT.direction
  );
}

/**
 * The view the address asks for. A value the route would refuse is read as not
 * applied — never sent to become a 400 page: an unknown state, sort key or
 * direction (the sort then falls back to the default whole), an impossible or
 * malformed day, a search over the route's {@link EVENTS_LIST_SEARCH_MAX}, a
 * page that is not a positive whole number, and the «по» of an inverted period
 * (its «с» kept). A sort key without a direction reads ascending, as the route
 * reads it.
 */
export function eventsListViewFromAddress(
  params: URLSearchParams,
): EventsListView {
  const read = (key: string) => (params.get(key) ?? "").trim();
  const q = read("q");
  const state = EventLifecycleStateSchema.safeParse(read("state"));
  const key = EventAdminListSortKeySchema.safeParse(params.get("sort"));
  const direction = EventAdminListSortDirSchema.safeParse(
    params.get("dir") ?? "asc",
  );
  const day = (name: string) => (isCalendarDay(read(name)) ? read(name) : "");
  const startsFrom = day("startsFrom");
  const to = day("startsTo");
  const page = Number(read("page"));
  return {
    q: q.length > EVENTS_LIST_SEARCH_MAX ? "" : q,
    state: state.success ? state.data : "",
    startsFrom,
    startsTo: startsFrom && to && to < startsFrom ? "" : to,
    sort:
      key.success && direction.success
        ? { key: key.data, direction: direction.data }
        : EVENTS_LIST_SORT_DEFAULT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * The address of `view`: every part it holds under the route's own names, the
 * search trimmed, blanks, page 1 and the default order left out.
 */
export function eventsListHref(pathname: string, view: EventsListView): string {
  const params = new URLSearchParams();
  const q = view.q.trim();
  if (q) params.set("q", q);
  if (view.state) params.set("state", view.state);
  if (view.startsFrom) params.set("startsFrom", view.startsFrom);
  if (view.startsTo) params.set("startsTo", view.startsTo);
  if (!isEventsListSortDefault(view.sort)) {
    params.set("sort", view.sort.key);
    params.set("dir", view.sort.direction);
  }
  if (view.page > 1) params.set("page", String(view.page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** A `YYYY-MM-DD` Moscow day as «01.10.2026» — a calendar date, never shifted. */
function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

/** The period chip's two ends, formatted; `""` = an open end, `null` = no period. */
export function eventsListPeriod(
  view: EventsListView,
): { from: string; to: string } | null {
  if (!view.startsFrom && !view.startsTo) return null;
  return {
    from: view.startsFrom ? formatDay(view.startsFrom) : "",
    to: view.startsTo ? formatDay(view.startsTo) : "",
  };
}

/** Which «order» wording a sort key reads in — «от А до Я», «новые сверху», … */
export function eventsListSortOrderKind(
  key: string,
): "text" | "date" | "state" {
  if (key === "startsAt") return "date";
  if (key === "state") return "state";
  return "text";
}
