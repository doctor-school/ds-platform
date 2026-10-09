import {
  type EventLiveStrip,
  EventsLiveReadSchema,
  EventsMonthEntriesReadSchema,
  type MonthBroadcastEntry,
  type MonthlyEventCount,
  MonthlyEventCountsSchema,
  type RawQueryRecord,
  SpecialtyBookSchema,
} from "@ds/schemas";

import type { EventsStorefrontHostConfig } from "../host-config";
import type { SpecialtyChoice } from "../model/facets";
import type { BlockRead, EventsFeedPage } from "../model/feed";
import { feedReadQuery, feedTenseOf, monthReadQuery } from "../model/feed-url";
import { type ForwardedSession, forwardedHeaders } from "./registration-state";

const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

function relayOnly(cookie: string, name: string | undefined): string {
  if (name === undefined) return "";
  return (
    cookie
      .split(";")
      .map((pair) => pair.trim())
      .find((pair) => pair.startsWith(`${name}=`)) ?? ""
  );
}

/**
 * The feed read (019 EARS-3, gate rows 12, 32). The read is viewer-independent
 * (019 EARS-12), so it forwards only the host's one relay cookie — the
 * remembered specialty on the doctor host — and the client address chain.
 */
export async function fetchEventsFeed(
  config: Pick<EventsStorefrontHostConfig, "contentSet" | "filterSet">,
  raw: RawQueryRecord,
  request: { readonly cookie: string; readonly forwardedFor: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<EventsFeedPage>> {
  const { contentSet } = config;
  const query = feedReadQuery(raw, contentSet.tenseParam, config.filterSet);
  const cookie = relayOnly(request.cookie, contentSet.relayCookie);
  try {
    const res = await fetchImpl(`${API_BASE}${contentSet.feedPath}?${query}`, {
      headers: {
        accept: "application/json",
        ...(cookie ? { cookie } : {}),
        ...(request.forwardedFor
          ? { "x-forwarded-for": request.forwardedFor }
          : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    return {
      ok: true,
      value: contentSet.adapt(await res.json(), { tense: feedTenseOf(raw) }),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * The home nearest-events read (017 EARS-9, wave-2 gate row 62, §4.3 D11):
 * the host's ONE feed read with the default upcoming window — general before a
 * specialty is chosen, targeted after, by the same relayed cookie as the
 * events page (row 13). «Nearest» must not read as empty because the next
 * event lies past the default window: when that window holds no card but the
 * api names a next bound, the read widens ONCE to it (the bound covers the
 * nearest matching day, the «Показать ещё» step of the page). `window` is the
 * default read — the compact month's extent, the one `/events` opens with.
 */
export async function fetchNearestEvents(
  config: ReadConfig,
  request: ReadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  readonly window: BlockRead<EventsFeedPage>;
  readonly nearest: BlockRead<EventsFeedPage>;
}> {
  const window = await fetchEventsFeed(config, {}, request, fetchImpl);
  if (
    !window.ok ||
    window.value.cards.length > 0 ||
    window.value.horizon.nextTo === null
  ) {
    return { window, nearest: window };
  }
  const { from, nextTo } = window.value.horizon;
  const nearest = await fetchEventsFeed(
    config,
    { from, to: nextTo },
    request,
    fetchImpl,
  );
  return { window, nearest };
}

/**
 * The «Идёт сейчас» read (019 EARS-6, D5). Viewer-DEPENDENT: the api picks the
 * room or the event page against the viewer's registration, so the session
 * rides with it.
 */
export async function fetchEventsLive(
  livePath: string,
  session: ForwardedSession,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<EventLiveStrip[]>> {
  try {
    const res = await fetchImpl(`${API_BASE}${livePath}`, {
      headers: forwardedHeaders(session),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    return { ok: true, value: EventsLiveReadSchema.parse(await res.json()) };
  } catch {
    return { ok: false };
  }
}

export type ReadRequest = { readonly cookie: string; readonly forwardedFor: string };
type ReadConfig = Pick<EventsStorefrontHostConfig, "contentSet" | "filterSet">;

async function readJson<T>(
  config: ReadConfig,
  path: string,
  query: URLSearchParams,
  request: ReadRequest,
  schema: { parse(value: unknown): T },
  fetchImpl: typeof fetch,
): Promise<BlockRead<T>> {
  const cookie = relayOnly(request.cookie, config.contentSet.relayCookie);
  try {
    const res = await fetchImpl(`${API_BASE}${path}?${query}`, {
      headers: {
        accept: "application/json",
        ...(cookie ? { cookie } : {}),
        ...(request.forwardedFor
          ? { "x-forwarded-for": request.forwardedFor }
          : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    return { ok: true, value: schema.parse(await res.json()) };
  } catch {
    return { ok: false };
  }
}

/** One month's entries under the page's facets (rows 53, 55). */
export function fetchMonthEntries(
  config: ReadConfig,
  raw: RawQueryRecord,
  month: string,
  request: ReadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<MonthBroadcastEntry[]>> {
  return readJson(
    config,
    config.contentSet.monthPath,
    monthReadQuery(raw, config.filterSet, { month }),
    request,
    EventsMonthEntriesReadSchema,
    fetchImpl,
  );
}

/** One year's per-month counts under the page's facets — the picker (row 54). */
export function fetchMonthCounts(
  config: ReadConfig,
  raw: RawQueryRecord,
  year: string,
  request: ReadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<MonthlyEventCount[]>> {
  return readJson(
    config,
    config.contentSet.countsPath,
    monthReadQuery(raw, config.filterSet, { year }),
    request,
    MonthlyEventCountsSchema,
    fetchImpl,
  );
}

/**
 * The specialties the doctor specialty facet offers (row 59) — the 017
 * specialty book, without its «Другое» entry (no specialty to narrow by). A
 * failed read offers none; the scope chips still work.
 */
export async function fetchSpecialtyChoices(
  fetchImpl: typeof fetch = fetch,
): Promise<SpecialtyChoice[]> {
  try {
    const res = await fetchImpl(`${API_BASE}/v1/public/specialties`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const book = SpecialtyBookSchema.parse(await res.json());
    return book.entries
      .filter((entry) => !entry.isOther)
      .map((entry) => ({ code: entry.code, name: entry.name }));
  } catch {
    return [];
  }
}
