import type { EventsFilterHost } from "@ds/design-system/blocks";
import {
  EVENTS_PAGE_QUERY_CODEC,
  type EventListingQueryEntry,
  addDoctorEventsFeedDays,
  type RawQueryRecord,
  encodeQueryString,
  rawQueryList,
  rawQueryScalar,
} from "@ds/schemas";

import type { EventsFeedHorizon, FeedTense } from "./feed";

/**
 * The events page's URL — ONE codec for both storefronts and both views (019
 * LD-1, gate rows 17, 51; §4.3 D1): the view (`view=month`, absent = the
 * feed), the displayed month, the tense, the horizon and every facet of either
 * host's set. Every href the page writes is built here from the codec's own
 * entries, never hand-assembled; the field table's order IS the URL's key
 * order (`EVENTS_PAGE_QUERY_CODEC`, `@ds/schemas`).
 *
 * The legacy Academy listing params that leave the URL (§4.3 D1). */
const LEGACY_PARAMS = ["tab", "cursor", "cursorTrail", "page"] as const;

/**
 * The facet keys of each host's `filterSet` (row 58) — the facets that reach
 * that host's reads; the rest of the codec never leaves the page.
 */
export const FACET_KEYS: Readonly<Record<EventsFilterHost, readonly string[]>> = {
  doctor: ["format", "kind", "specialty", "city", "nmo", "free", "q"],
  academy: ["project", "expert", "topic"],
};

/** The horizon keys a feed read takes besides the facets. */
const HORIZON_KEYS = ["from", "to"] as const;

/**
 * The codec's entries without the values the codec defaults to — the canonical
 * URL states only what differs from the default reading.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
  tense: "upcoming",
  specialty: "mine-and-adjacent",
};
function codecEntries(raw: RawQueryRecord): EventListingQueryEntry[] {
  return EVENTS_PAGE_QUERY_CODEC.reencode(raw).filter(
    ([key, value]) => DEFAULTS[key] !== value,
  );
}

function href(listing: string, entries: readonly EventListingQueryEntry[]): string {
  const query = encodeQueryString(entries);
  return query ? `${listing}?${query}` : listing;
}

/** The page at a raw query — the canonical href of any state the page writes. */
export function pageHref(listing: string, raw: RawQueryRecord): string {
  return href(listing, codecEntries(raw));
}

/** The tense a raw query reads — «Будущие» unless it says `tense=past`. */
export function feedTenseOf(raw: RawQueryRecord): FeedTense {
  return rawQueryScalar(raw.tense) === "past" ? "past" : "upcoming";
}

/**
 * §4.3 D1 — a legacy Academy listing URL answers a permanent redirect to its
 * canonical form: `tab=past` → `tense=past`; `cursor`, `cursorTrail` and `page`
 * are dropped (the reader lands on the first batch); `view` / `month` keep
 * their meaning in the codec. `null` when the URL is canonical already.
 */
export function canonicalFeedRedirect(
  listing: string,
  raw: RawQueryRecord,
): string | null {
  if (!LEGACY_PARAMS.some((key) => raw[key] !== undefined)) return null;
  const tense =
    rawQueryScalar(raw.tab) === "past" ? "past" : feedTenseOf(raw);
  const rest: RawQueryRecord = { ...raw };
  for (const key of LEGACY_PARAMS) delete rest[key];
  rest.tense = tense === "past" ? "past" : undefined;
  return href(listing, codecEntries(rest));
}

/**
 * A tense tab's href: the facets stay, the horizon resets — a horizon is the
 * extent of one tense's reading and means nothing in the other.
 */
export function tenseHref(
  listing: string,
  raw: RawQueryRecord,
  tense: FeedTense,
): string {
  const next: RawQueryRecord = {
    ...raw,
    tense: tense === "past" ? "past" : undefined,
    from: undefined,
    to: undefined,
    day: undefined,
  };
  return href(listing, codecEntries(next));
}

/**
 * «Показать ещё» — the same reading over a wider extent: «Будущие» widens `to`
 * to the read's `nextTo`, «Прошедшие» widens `from` back to `nextFrom` (D2).
 * `null` when nothing lies beyond in the reading's direction.
 */
export function showMoreHref(
  listing: string,
  raw: RawQueryRecord,
  horizon: EventsFeedHorizon,
): string | null {
  const past = feedTenseOf(raw) === "past";
  const from = past ? horizon.nextFrom : horizon.from;
  const to = past ? horizon.to : horizon.nextTo;
  if (from === null || to === null) return null;
  return href(listing, codecEntries({ ...raw, from, to }));
}

/** The feed href with one facet value (or the whole facet) removed. */
export function withoutFeedParam(
  listing: string,
  raw: RawQueryRecord,
  key: string,
  value?: string,
): string {
  const next: RawQueryRecord = { ...raw };
  if (value === undefined) {
    next[key] = undefined;
  } else {
    const rest = (rawQueryList(raw[key]) ?? []).filter((v) => v !== value);
    next[key] = rest.length > 0 ? rest : undefined;
  }
  return href(listing, codecEntries(next));
}

/** Only the entries of `keys`, in the codec's order. */
function onlyKeys(
  entries: readonly EventListingQueryEntry[],
  keys: readonly string[],
): EventListingQueryEntry[] {
  return entries.filter(([key]) => keys.includes(key));
}

/**
 * The feed READ's query: the horizon and the host set's facets of the codec,
 * with the tense under the name the host's read takes (`contentSet.tenseParam`)
 * — always stated, since a read without it is a different read on the Academy
 * api. The view, the month and the other host's facets never reach a read.
 */
export function feedReadQuery(
  raw: RawQueryRecord,
  tenseParam: string,
  filterSet: EventsFilterHost,
): URLSearchParams {
  const tense = feedTenseOf(raw);
  const entries = onlyKeys(codecEntries(raw), [
    ...HORIZON_KEYS,
    ...FACET_KEYS[filterSet],
  ]);
  return new URLSearchParams([...entries, [tenseParam, tense]]);
}

/**
 * A month READ's query (row 54): the month (or the counts' year) and the host
 * set's facets — the month view and the picker narrow as the feed does.
 */
export function monthReadQuery(
  raw: RawQueryRecord,
  filterSet: EventsFilterHost,
  period: { month: string } | { year: string },
): URLSearchParams {
  const facets = onlyKeys(codecEntries(raw), FACET_KEYS[filterSet]);
  return new URLSearchParams([...Object.entries(period), ...facets]);
}

/** The view the URL selects — the feed unless it says `view=month`. */
export function pageViewOf(raw: RawQueryRecord): "feed" | "month" {
  return rawQueryScalar(raw.view) === "month" ? "month" : "feed";
}

/** The displayed month the URL names, if well-formed. */
export function pageMonthOf(raw: RawQueryRecord): string | undefined {
  const parsed = EVENTS_PAGE_QUERY_CODEC.parse(raw);
  return parsed.success ? parsed.data.month : undefined;
}

/**
 * The switch between the two views of the one page (row 51): «Календарь на
 * месяц →» / «← Лента событий». The tense and the facets stay; the horizon and
 * the day are the feed's extent and leave with it.
 */
export function viewHref(
  listing: string,
  raw: RawQueryRecord,
  view: "feed" | "month",
): string {
  return href(
    listing,
    codecEntries({
      ...raw,
      view: view === "month" ? "month" : undefined,
      day: undefined,
      from: undefined,
      to: undefined,
    }),
  );
}

/**
 * The page with another displayed month (‹ ›, the picker, «Сегодня» — absent
 * = the current month): the view, the tense and the facets stay; a day
 * selection belongs to the month it was made in.
 */
export function monthHref(
  listing: string,
  raw: RawQueryRecord,
  month: string | undefined,
): string {
  return href(listing, codecEntries({ ...raw, month, day: undefined }));
}

/**
 * The feed moved to `date` (rows 56, 57): the current query with `day` (the
 * day the feed scrolls to — it never narrows the read) and that day's month.
 * A day the served extent does not hold widens the extent in the tense's
 * direction so the day is inside the read: «Будущие» widens the exclusive `to`
 * to the day after it, «Прошедшие» widens `from` back to it. With no extent
 * known the href never invents one.
 */
export function dayHref(
  listing: string,
  raw: RawQueryRecord,
  date: string,
  horizon?: { from: string; to: string },
): string {
  const past = feedTenseOf(raw) === "past";
  const widen =
    horizon === undefined
      ? {}
      : !past && date >= horizon.to
        ? { from: horizon.from, to: addDoctorEventsFeedDays(date, 1) }
        : past && date < horizon.from
          ? { from: date, to: horizon.to }
          : {};
  return href(
    listing,
    codecEntries({
      ...raw,
      ...widen,
      view: undefined,
      day: date,
      month: date.slice(0, 7),
    }),
  );
}
