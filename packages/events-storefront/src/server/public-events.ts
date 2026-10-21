import {
  type PublicEventPage,
  forwardedHeaders,
  forwardedSessionFrom,
} from "@ds/schemas";

import { relayOnly } from "./events-feed";

/**
 * Server-side reader for the 004 public event-page projection (EARS-1). The
 * event page renders server-side, so this runs on the server and calls the api
 * directly (a server component cannot use the browser's same-origin `/v1/*`
 * rewrite). The upstream is env-driven — the same `API_PROXY_TARGET` each host's
 * rewrite uses — never a hardcoded host.
 *
 * The read is session-free (020 EARS-1): the body carries no per-session
 * variation. It forwards only the client chain (`x-forwarded-for`, #2054 —
 * `request.ip` keys the api's rate-limit windows) and the host's one relay
 * cookie (`contentSet.relayCookie`, wave-3 gate D4 — 017's remembered specialty
 * on the doctor host; the Academy declares none). Never the session cookie or
 * its fingerprint surface.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/** The host's read of the page (`@ds/event-page` `contentSet`, gate §4.4). */
export type PublicEventPageRead = {
  readonly pagePath: string;
  readonly relayCookie?: string;
};

/**
 * 020 EARS-19 — the page's error state tells the viewer the server did not
 * answer within 10 seconds; the read holds to that: a hung api aborts here and
 * the host's `error.tsx` renders `EventPageError`.
 */
const EVENT_PAGE_READ_TIMEOUT_MS = 10_000;

/**
 * Fetch the publish-safe projection at `${pagePath}/:slug`, or `null` when the
 * event is not publicly reachable (404 — draft/unknown).
 */
export async function fetchPublicEventPage(
  idOrSlug: string,
  read: PublicEventPageRead,
  incoming: Headers,
): Promise<PublicEventPage | null> {
  const relay = relayOnly(incoming.get("cookie") ?? "", read.relayCookie);
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new Error("public event page read timed out")),
    EVENT_PAGE_READ_TIMEOUT_MS,
  );
  const res = await fetch(
    `${API_BASE}${read.pagePath}/${encodeURIComponent(idOrSlug)}`,
    {
      headers: {
        // The canonical hop builder with the session surface stripped: only the
        // client chain rides from it.
        ...forwardedHeaders({ ...forwardedSessionFrom(incoming), cookie: "" }),
        ...(relay ? { cookie: relay } : {}),
      },
      // Live product read — uncached (#843). A lifecycle transition
      // (published→live→ended) must surface on the very next request, never
      // after a timer window. If caching is ever reintroduced here, it must be
      // invalidated ON the lifecycle transition (on-demand revalidation), never
      // by timer.
      cache: "no-store",
      signal: abort.signal,
    },
  ).finally(() => clearTimeout(timer));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`public event page fetch failed (${res.status})`);
  }
  return (await res.json()) as PublicEventPage;
}
