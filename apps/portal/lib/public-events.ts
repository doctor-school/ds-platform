import type {
  MonthBroadcastEntry,
  MonthlyEventCount,
  PublicEventPage,
  PublicEventListingPage,
  UpcomingBroadcastCard,
} from "@ds/schemas";

/**
 * Server-side reader for the 004 public event-page projection (EARS-1). The
 * portal's `/webinars/:slug` route renders server-side, so this runs on the
 * server and calls the api directly (a server component cannot use the browser's
 * same-origin `/v1/*` rewrite). The upstream is env-driven — the same
 * `API_PROXY_TARGET` the portal's rewrite uses (`next.config.ts`) — never a
 * hardcoded host, so dev (local api) and prod (internal service URL) differ by
 * config only. No cookie is sent: the endpoint is public and its body carries no
 * per-session variation (EARS-1), so the render is identical for any recipient.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/** Fetch the publish-safe projection, or `null` when the event is not publicly reachable (404 — draft/unknown). */
export async function fetchPublicEventPage(
  idOrSlug: string,
): Promise<PublicEventPage | null> {
  const res = await fetch(
    `${API_BASE}/v1/public/events/${encodeURIComponent(idOrSlug)}`,
    {
      headers: { accept: "application/json" },
      // Live product read — uncached (#843). A lifecycle transition
      // (published→live→ended) must surface on the very next request, never
      // after a timer window: `revalidate: 30` let a LIVE broadcast keep
      // advertising as upcoming for up to 30s plus one stale-while-revalidate
      // response. If caching is ever reintroduced here, it must be invalidated
      // ON the lifecycle transition (on-demand revalidation, e.g.
      // revalidateTag) — never by timer.
      cache: "no-store",
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`public event page fetch failed (${res.status})`);
  }
  return (await res.json()) as PublicEventPage;
}

/**
 * Fetch the upcoming-broadcasts listing (004 EARS-7) — the `UpcomingBroadcastCard[]`
 * projection ordered nearest air date first. Public + uncached like the event
 * page; a `[]` is a valid result (the listing renders the empty-state, EARS-11).
 * Same env-driven upstream, no cookie — the body carries no per-session variation.
 */
export async function fetchUpcomingBroadcasts(): Promise<
  UpcomingBroadcastCard[]
> {
  const res = await fetch(`${API_BASE}/v1/public/events?upcoming`, {
    headers: { accept: "application/json" },
    // Live product read — uncached (#843): the same no-store policy as the
    // event page above. Lifecycle transitions surface on the very next
    // request; any future cache must be invalidated on the transition
    // (on-demand revalidation), never by timer.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`upcoming broadcasts fetch failed (${res.status})`);
  }
  return (await res.json()) as UpcomingBroadcastCard[];
}

/**
 * The api rejected the opaque `cursor` (400). Distinguished from a real upstream
 * failure so the listing can restart at the first page instead of erroring out
 * (#1640): the cursor rides in a shareable, hand-editable URL, and a truncated or
 * stale one is a routine visitor situation, not a fault.
 */
export class InvalidEventCursorError extends Error {
  constructor(cursor: string) {
    super(`event listing cursor rejected (400): ${cursor}`);
    this.name = "InvalidEventCursorError";
  }
}

export interface EventListingInput {
  timeframe: "upcoming" | "past";
  cursor?: string;
  limit?: number;
}

/**
 * Cursor-paged public feed for the controlled upcoming/past tabs (014 EARS-11).
 *
 * A 400 WITH a cursor in play is surfaced as {@link InvalidEventCursorError} — the
 * cursor is opaque (`@ds/schemas` bounds only its length), so the api is the only
 * component that can judge it, and its 400 is the correct answer, not a defect.
 * The classification rides the published `errorCode` (`014-design.md` error table:
 * `VALIDATION_FAILED` | `CURSOR_INVALID` | `IDEMPOTENCY_KEY_INVALID`), so a 400
 * raised by some OTHER param while a cursor happens to be in play surfaces as the
 * real fault instead of being silently retried as page 1. A 400 body carrying no
 * `errorCode` at all keeps the cursor reading — the safe fallback for an upstream
 * that answers off-contract. Every other non-ok status stays a generic failure.
 */
export async function fetchEventListing(
  input: EventListingInput,
): Promise<PublicEventListingPage> {
  const query = new URLSearchParams({ timeframe: input.timeframe });
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  const res = await fetch(`${API_BASE}/v1/public/events?${query}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 400 && input.cursor) {
    const body = (await res.json().catch(() => null)) as {
      errorCode?: unknown;
    } | null;
    const errorCode = body?.errorCode;
    if (errorCode === undefined || errorCode === "CURSOR_INVALID") {
      throw new InvalidEventCursorError(input.cursor);
    }
  }
  if (!res.ok) throw new Error(`event listing fetch failed (${res.status})`);
  return (await res.json()) as PublicEventListingPage;
}

/**
 * {@link fetchEventListing} with the #1640 boundary policy applied: a cursor the
 * api rejects is treated as "start from the first page" and reported back through
 * `cursorRejected`, so the caller can also reset the page counter and the
 * pagination links it hands to the UI. Any other failure propagates untouched —
 * a genuinely broken upstream must still reach the route's error boundary.
 */
export async function fetchEventListingWithCursorFallback(
  input: EventListingInput,
): Promise<{ listing: PublicEventListingPage; cursorRejected: boolean }> {
  try {
    return { listing: await fetchEventListing(input), cursorRejected: false };
  } catch (error) {
    if (!(error instanceof InvalidEventCursorError)) throw error;
    return {
      listing: await fetchEventListing({ ...input, cursor: undefined }),
      cursorRejected: true,
    };
  }
}

/**
 * Fetch the month-grid projection (004 EARS-15/EARS-19) — the
 * `MonthBroadcastEntry[]` for one МСК calendar month (`YYYY-MM`), ordered nearest
 * air date first and INCLUDING the month's already-past (`ended`) events (the
 * month view renders those as muted aggregate notes). Public + uncached like the
 * sibling reads; an empty month is a valid `[]`. Same env-driven upstream, no
 * cookie — the body carries no per-session variation.
 */
export async function fetchMonthBroadcasts(
  month: string,
): Promise<MonthBroadcastEntry[]> {
  const res = await fetch(
    `${API_BASE}/v1/public/events?month=${encodeURIComponent(month)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`month broadcasts fetch failed (${res.status})`);
  }
  return (await res.json()) as MonthBroadcastEntry[];
}

/**
 * Fetch the 12-month event counts for a year (004 EARS-16) — exactly 12
 * `MonthlyEventCount` rows the month picker reads. Public + uncached. Returned
 * here for the pane's hero/period context; the picker's paging INTERACTION is a
 * later slice (#1051).
 */
export async function fetchMonthlyCounts(
  year: string,
): Promise<MonthlyEventCount[]> {
  const res = await fetch(
    `${API_BASE}/v1/public/events/month-counts?year=${encodeURIComponent(year)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`monthly counts fetch failed (${res.status})`);
  }
  return (await res.json()) as MonthlyEventCount[];
}
