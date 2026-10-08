import {
  DOCTOR_EVENTS_FEED_QUERY_CODEC,
  type EventListingQueryEntry,
  type RawQueryRecord,
  encodeQueryString,
  rawQueryList,
  rawQueryScalar,
} from "@ds/schemas";

import type { EventsFeedHorizon, FeedTense } from "./feed";

/**
 * The feed's URL — ONE codec for both storefronts (019 LD-1, gate row 17): the
 * tense, the horizon and the facets of `DOCTOR_EVENTS_FEED_QUERY_CODEC`. Every
 * href the feed view writes is built here from the codec's own entries, never
 * hand-assembled.
 */

/** The legacy Academy listing params that leave the URL (§4.3 D1). */
const LEGACY_PARAMS = ["tab", "cursor", "cursorTrail", "page"] as const;

/**
 * The month-view params the codec does not carry until PR 2.5 (row 51): a feed
 * href passes them through unchanged so a month link never loses them (D1).
 */
const PASSTHROUGH_PARAMS = ["view", "month"] as const;

/**
 * The codec's entries without the values the codec defaults to — the canonical
 * URL states only what differs from the default reading.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
  tense: "upcoming",
  specialty: "mine-and-adjacent",
};
function codecEntries(raw: RawQueryRecord): EventListingQueryEntry[] {
  return DOCTOR_EVENTS_FEED_QUERY_CODEC.reencode(raw).filter(
    ([key, value]) => DEFAULTS[key] !== value,
  );
}

function href(listing: string, entries: readonly EventListingQueryEntry[]): string {
  const query = encodeQueryString(entries);
  return query ? `${listing}?${query}` : listing;
}

function passthrough(raw: RawQueryRecord): EventListingQueryEntry[] {
  const entries: EventListingQueryEntry[] = [];
  for (const key of PASSTHROUGH_PARAMS) {
    const value = rawQueryScalar(raw[key]);
    if (value !== undefined) entries.push([key, value]);
  }
  return entries;
}

/** The tense a raw query reads — «Будущие» unless it says `tense=past`. */
export function feedTenseOf(raw: RawQueryRecord): FeedTense {
  return rawQueryScalar(raw.tense) === "past" ? "past" : "upcoming";
}

/**
 * §4.3 D1 — a legacy Academy listing URL answers a permanent redirect to its
 * canonical form: `tab=past` → `tense=past`; `cursor`, `cursorTrail` and `page`
 * are dropped (the reader lands on the first batch); `view` / `month` pass
 * through. `null` when the URL is canonical already.
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
  return href(listing, [
    ...passthrough(rest),
    ...codecEntries(rest),
  ]);
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

/**
 * The feed READ's query: the codec's entries with the tense under the name the
 * host's read takes (`contentSet.tenseParam`) — always stated, since a read
 * without it is a different read on the Academy api.
 */
export function feedReadQuery(
  raw: RawQueryRecord,
  tenseParam: string,
): URLSearchParams {
  const tense = feedTenseOf(raw);
  const entries = codecEntries({ ...raw, tense: undefined });
  return new URLSearchParams([...entries, [tenseParam, tense]]);
}
