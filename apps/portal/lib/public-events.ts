import type { PublicEventPage, UpcomingBroadcastCard } from "@ds/schemas";

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
const API_BASE = (process.env.API_PROXY_TARGET ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/** Fetch the publish-safe projection, or `null` when the event is not publicly reachable (404 — draft/unknown). */
export async function fetchPublicEventPage(
  idOrSlug: string,
): Promise<PublicEventPage | null> {
  const res = await fetch(
    `${API_BASE}/v1/public/events/${encodeURIComponent(idOrSlug)}`,
    {
      headers: { accept: "application/json" },
      // Public + cacheable; revalidate briefly so a lifecycle transition
      // (published→live→ended) surfaces on the SSR page within the window
      // (mirrors the endpoint's short Cache-Control, 004 design §4).
      next: { revalidate: 30 },
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
 * projection ordered nearest air date first. Public + cacheable like the event
 * page; a `[]` is a valid result (the listing renders the empty-state, EARS-11).
 * Same env-driven upstream, no cookie — the body carries no per-session variation.
 */
export async function fetchUpcomingBroadcasts(): Promise<
  UpcomingBroadcastCard[]
> {
  const res = await fetch(`${API_BASE}/v1/public/events?upcoming`, {
    headers: { accept: "application/json" },
    // Mirror the endpoint's short Cache-Control so a lifecycle transition
    // (published→live→ended) surfaces on the SSR listing within the window
    // (004 design §4).
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    throw new Error(`upcoming broadcasts fetch failed (${res.status})`);
  }
  return (await res.json()) as UpcomingBroadcastCard[];
}
