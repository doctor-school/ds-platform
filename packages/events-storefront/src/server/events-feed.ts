import {
  type EventLiveStrip,
  type ForwardedSession,
  forwardedHeaders,
  EventsLiveReadSchema,
  hasSessionCookie,
  EventsMonthEntriesReadSchema,
  type MonthBroadcastEntry,
  type MonthlyEventCount,
  MonthlyEventCountsSchema,
  PublicEventKindListSchema,
  type RawQueryRecord,
  SpecialtyBookSchema,
  specialtyFeedBlockRead,
} from "@ds/schemas";

import { adaptFeedEvents } from "../adapters";

import type { EventsStorefrontHostConfig } from "../host-config";
import type { KindTitle, SpecialtyChoice } from "../model/facets";
import type { BlockRead, EventsFeedCard, EventsFeedPage } from "../model/feed";
import { feedReadQuery, feedTenseOf, monthReadQuery } from "../model/feed-url";

const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/** The one `name=value` pair of the host's relay cookie in a raw `Cookie` header, or `""`. */
export function relayOnly(cookie: string, name: string | undefined): string {
  if (name === undefined) return "";
  return (
    cookie
      .split(";")
      .map((pair) => pair.trim())
      .find((pair) => pair.startsWith(`${name}=`)) ?? ""
  );
}

/**
 * The headers of a feed-page read — the feed, one month, the month counts
 * (019 EARS-3, 017; #2885). On a host whose reads target a specialty (it names a
 * relay cookie) a signed-in viewer's read carries the whole session surface the
 * way the live strip does, so the api can name the profile specialty; every
 * other read carries only the relay cookie and the client address chain. The
 * Academy host names no relay cookie, so its reads are unchanged. A read built
 * here depends on the viewer and is always fetched `no-store`.
 */
export function feedReadHeaders(
  contentSet: Pick<EventsStorefrontHostConfig["contentSet"], "relayCookie">,
  request: ReadRequest,
): Record<string, string> {
  if (
    contentSet.relayCookie !== undefined &&
    hasSessionCookie(request.cookie)
  ) {
    return forwardedHeaders(request);
  }
  const cookie = relayOnly(request.cookie, contentSet.relayCookie);
  return {
    accept: "application/json",
    ...(cookie ? { cookie } : {}),
    ...(request.forwardedFor
      ? { "x-forwarded-for": request.forwardedFor }
      : {}),
  };
}

/** The feed read (019 EARS-3, gate rows 12, 32); headers per {@link feedReadHeaders}. */
export async function fetchEventsFeed(
  config: Pick<EventsStorefrontHostConfig, "contentSet" | "filterSet">,
  raw: RawQueryRecord,
  request: ReadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<EventsFeedPage>> {
  const { contentSet } = config;
  const query = feedReadQuery(raw, contentSet.tenseParam, config.filterSet);
  try {
    const res = await fetchImpl(`${API_BASE}${contentSet.feedPath}?${query}`, {
      headers: feedReadHeaders(contentSet, request),
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
 * rides with it. It reads `liveHref` — the host's live path under the page's
 * applied filter set (`liveReadHref`) — and, like the feed, it carries the host's
 * relay cookie (the remembered specialty) for a GUEST too: without it a guest's
 * «моя и смежные» strip would fall back to every specialty (#2907). A signed-in
 * viewer's cookie header already carries it.
 */
export async function fetchEventsLive(
  liveHref: string,
  config: Pick<EventsStorefrontHostConfig, "contentSet">,
  session: ForwardedSession,
  request: ReadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<EventLiveStrip[]>> {
  const cookie =
    session.cookie !== ""
      ? session.cookie
      : relayOnly(request.cookie, config.contentSet.relayCookie);
  try {
    const res = await fetchImpl(`${API_BASE}${liveHref}`, {
      headers: forwardedHeaders({ ...session, cookie }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    return { ok: true, value: EventsLiveReadSchema.parse(await res.json()) };
  } catch {
    return { ok: false };
  }
}

/** The incoming request's raw cookie header and session fingerprint surface. */
export type ReadRequest = {
  readonly cookie: string;
  readonly userAgent: string;
  readonly acceptLanguage: string;
  readonly forwardedFor: string;
};

/**
 * What every feed-page read may forward from the incoming request — the page
 * render's or a block retry's (#2832): its cookie, the session's fingerprint
 * surface (`forwardedSessionFrom`) and the client address.
 */
export function readRequestFrom(headers: Headers): ReadRequest {
  return {
    cookie: headers.get("cookie") ?? "",
    userAgent: headers.get("user-agent") ?? "",
    acceptLanguage: headers.get("accept-language") ?? "",
    forwardedFor: headers.get("x-forwarded-for") ?? "",
  };
}
type ReadConfig = Pick<EventsStorefrontHostConfig, "contentSet" | "filterSet">;

async function readJson<T>(
  config: ReadConfig,
  path: string,
  query: URLSearchParams,
  request: ReadRequest,
  schema: { parse(value: unknown): T },
  fetchImpl: typeof fetch,
): Promise<BlockRead<T>> {
  try {
    const res = await fetchImpl(`${API_BASE}${path}?${query}`, {
      headers: feedReadHeaders(config.contentSet, request),
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

/**
 * The public event-kind dictionary — every published or retired kind (012
 * EARS-28, Amendment — 2026-10-13): it names an applied kind the feed read
 * does not offer under the current reading, and a slug it does not carry is
 * not applied (019 EARS-7). A failed read is `null` — unknown, not empty.
 */
export async function fetchEventKindTitles(
  fetchImpl: typeof fetch = fetch,
): Promise<KindTitle[] | null> {
  try {
    const res = await fetchImpl(`${API_BASE}/v1/public/event-kinds`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return PublicEventKindListSchema.parse(await res.json()).data.map(
      ({ slug, title }) => ({ slug, title }),
    );
  } catch {
    return null;
  }
}

/**
 * 018 EARS-4 — the specialty feed's nearest-events read
 * (`GET /v1/storefront/feed/{specialty}/events`). The path is minted from the
 * specialty code by the ONE schema helper, never taken from a caller, so a
 * block retry cannot be pointed at another api path. The read is viewer-
 * independent: only the client address chain rides along.
 */
export async function fetchSpecialtyFeedEvents(
  specialtyCode: string,
  request: ReadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<BlockRead<{ cards: EventsFeedCard[]; allEventsHref: string }>> {
  try {
    const res = await fetchImpl(
      `${API_BASE}${specialtyFeedBlockRead(specialtyCode, "events")}`,
      {
        headers: {
          accept: "application/json",
          ...(request.forwardedFor
            ? { "x-forwarded-for": request.forwardedFor }
            : {}),
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return { ok: false };
    return { ok: true, value: adaptFeedEvents(await res.json()) };
  } catch {
    return { ok: false };
  }
}
