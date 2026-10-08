import {
  type EventLiveStrip,
  EventsLiveReadSchema,
  EventsMonthEntriesReadSchema,
  type MonthBroadcastEntry,
  type MonthlyEventCount,
  MonthlyEventCountsSchema,
  type RawQueryRecord,
} from "@ds/schemas";

import type { EventsStorefrontHostConfig } from "../host-config";
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

type ReadRequest = { readonly cookie: string; readonly forwardedFor: string };
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
