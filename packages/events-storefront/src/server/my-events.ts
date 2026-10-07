import type { MyEvents, MyEventsTab } from "@ds/schemas";

import { forwardedHeaders, type ForwardedSession } from "./registration-state";

/**
 * 005 EARS-6 / 014 EARS-9 — the `MyEvents` read composed onto the «Мои события»
 * surface, a SEPARATE authenticated read like {@link fetchEventRegistrationState}.
 *
 * The endpoint is the host's `contentSet.myEventsPath` (gate row 15, §4.3 D8):
 * `GET /v1/me/events` on the Academy, `GET /v1/storefront/doctor/me/events` on
 * the doctor storefront — each resolves the room href for its own host.
 *
 * `GET <path>?tab=upcoming|recordings` is `doctor_guest`-authenticated
 * (EARS-10): the surface is server-rendered, so this runs on the server and
 * forwards the incoming request's session cookie AND its fingerprint headers (the
 * BFF session is fingerprint-bound, ADR-0001 §6 — a server-to-server read must
 * present the same `user-agent`, `accept-language` AND client address the browser
 * bound at login, or the api 401s a valid session — #2054, the bounce this page
 * showed to signed-in doctors in production). The upstream is the same env-driven
 * `API_PROXY_TARGET` the rest of the portal's server reads use — never a
 * hardcoded host.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/**
 * The read outcome the «Мои события» page renders from:
 *   • `{ authenticated: true, events }` — the `MyEvents` envelope for the requested
 *     tab (`{ tab, data, counts }`; `data` may be `[]`, which renders the tab's
 *     empty-state, EARS-6/EARS-12), the `counts` feeding BOTH tab chips so the
 *     other tab's number is right without a second read;
 *   • `{ authenticated: false }` — no/expired session (401) or no cookie rode the
 *     request; the page redirects the guest to login (the surface is authenticated,
 *     unlike the public 004 pages).
 */
export type MyEventsResult =
  | { readonly authenticated: true; readonly events: MyEvents }
  | { readonly authenticated: false };

/**
 * Read one tab of the calling doctor's `MyEvents` envelope, forwarding the
 * request's session cookie + fingerprint headers. A missing cookie or a 401
 * collapses to `{ authenticated: false }` (the page sends the guest to login); an
 * empty `data` array is a valid authenticated result (the empty-state). Per-user
 * ⇒ never shared-cacheable (`cache: "no-store"`), keeping this out of the data
 * cache that backs the public projections (design §5).
 */
export async function fetchMyEvents(
  path: string,
  session: ForwardedSession,
  tab: MyEventsTab = "upcoming",
): Promise<MyEventsResult> {
  // No session cookie rode the request → a guest; never issue the authed read.
  if (!session.cookie) return { authenticated: false };

  const res = await fetch(`${API_BASE}${path}?tab=${tab}`, {
    // The whole fingerprint surface (ADR-0001 §6), forwarded client address
    // included — without it the api re-derives a different fingerprint and 401s
    // a valid session (#2054).
    headers: forwardedHeaders(session),
    // Per-user, authenticated — MUST NOT be shared-cached (design §5).
    cache: "no-store",
  });
  if (res.status === 401) return { authenticated: false };
  if (!res.ok) {
    throw new Error(`my events fetch failed (${res.status})`);
  }
  return { authenticated: true, events: (await res.json()) as MyEvents };
}
