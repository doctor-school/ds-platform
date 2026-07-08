import type { MyEventItem, MyEvents } from "@ds/schemas";

import { formatMskDayLabel, mskDayKey } from "./msk";
import type { ForwardedSession } from "./registration-state";

/**
 * 005 EARS-6 — the `MyEvents` read composed onto the «мои события» surface, a
 * SEPARATE authenticated read like {@link fetchEventRegistrationState}.
 *
 * `GET /v1/me/events` is `doctor_guest`-authenticated (EARS-10): the surface is
 * server-rendered, so this runs on the server and forwards the incoming request's
 * session cookie AND its fingerprint headers (the BFF session is fingerprint-bound,
 * ADR-0001 §6 — a server-to-server read must present the same `user-agent` +
 * `accept-language` the browser bound at login, or the api 401s a valid session).
 * The upstream is the same env-driven `API_PROXY_TARGET` the rest of the portal's
 * server reads use — never a hardcoded host.
 */
const API_BASE = (process.env.API_PROXY_TARGET ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/**
 * The read outcome the «мои события» page renders from:
 *   • `{ authenticated: true, events }` — the caller's registered upcoming events
 *     (possibly `[]`, which renders the canvas empty-state, EARS-6/EARS-12);
 *   • `{ authenticated: false }` — no/expired session (401) or no cookie rode the
 *     request; the page redirects the guest to login (the surface is authenticated,
 *     unlike the public 004 pages).
 */
export type MyEventsResult =
  | { readonly authenticated: true; readonly events: MyEvents }
  | { readonly authenticated: false };

/**
 * Read the calling doctor's `MyEvents` list, forwarding the request's session
 * cookie + fingerprint headers. A missing cookie or a 401 collapses to
 * `{ authenticated: false }` (the page sends the guest to login); a `[]` body is a
 * valid authenticated result (the empty-state). Per-user ⇒ never shared-cacheable
 * (`cache: "no-store"`), keeping this out of the data cache that backs the public
 * projections (design §5).
 */
export async function fetchMyEvents(
  session: ForwardedSession,
): Promise<MyEventsResult> {
  // No session cookie rode the request → a guest; never issue the authed read.
  if (!session.cookie) return { authenticated: false };

  const res = await fetch(`${API_BASE}/v1/me/events`, {
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      // Forward the fingerprint surface (ADR-0001 §6) — without it the api
      // re-derives a different fingerprint and 401s a valid session.
      "user-agent": session.userAgent,
      "accept-language": session.acceptLanguage,
    },
    // Per-user, authenticated — MUST NOT be shared-cached (design §5).
    cache: "no-store",
  });
  if (res.status === 401) return { authenticated: false };
  if (!res.ok) {
    throw new Error(`my events fetch failed (${res.status})`);
  }
  return { authenticated: true, events: (await res.json()) as MyEvents };
}

/** One Europe/Moscow calendar-day group of «мои события» rows, nearest-first order preserved. */
export interface MyEventsDayGroup {
  /** Stable `YYYY-MM-DD` МСК day key (grouping identity). */
  readonly key: string;
  /** Day-header label, e.g. `16 июля, среда` (МСК). */
  readonly label: string;
  readonly events: MyEventItem[];
}

/**
 * Group the already-nearest-first `MyEvents` rows by their Europe/Moscow calendar
 * day, PRESERVING the server's `starts_at ASC` order (EARS-6, EARS-11). The
 * grouping key + label are computed in `Europe/Moscow` (via {@link mskDayKey} /
 * {@link formatMskDayLabel}), so the day rhythm never drifts to the viewer's local
 * timezone regardless of the server's or browser's TZ. Pure — the single unit the
 * «мои события» surface renders, unit-tested independent of any browser.
 */
export function groupMyEventsByDay(events: MyEvents): MyEventsDayGroup[] {
  const groups: MyEventsDayGroup[] = [];
  for (const event of events) {
    const key = mskDayKey(event.startsAt);
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({
        key,
        label: formatMskDayLabel(event.startsAt),
        events: [event],
      });
    }
  }
  return groups;
}
