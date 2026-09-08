import type { EventRegistrationState } from "@ds/schemas";

/**
 * 005 EARS-4 — the per-user `EventRegistrationState` composed onto the event
 * page, WITHOUT contaminating 004's public, cacheable projection.
 *
 * 004's `GetPublicEventPage` stays public, cookie-free, and content-identical for
 * guest and principal. The doctor's registration state is a SEPARATE
 * authenticated read (design §4): this module fetches
 * `GET /v1/events/:idOrSlug/registration` server-side, forwarding the session
 * cookie of the incoming request, and never touches the public fetch or its
 * shared data cache. A guest (no session) simply gets `null` here and sees 004's
 * register CTA.
 *
 * It lives in the shared unit because BOTH storefronts compose the same per-user
 * fact onto the same event page (020 EARS-1): the read, its `null` collapse and
 * its fingerprint-forwarding contract must not be able to drift between hosts.
 *
 * The upstream is the same env-driven `API_PROXY_TARGET` each host's rewrite and
 * public reader use (`next.config.ts`) — never a hardcoded host, so dev and prod
 * differ by config only.
 */
const API_BASE = (process.env.API_PROXY_TARGET ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/** The BFF session cookie name. `__Host-` = origin-locked, no `Domain`. */
export const SESSION_COOKIE_NAME = "__Host-ds_session";

/**
 * True when the raw `Cookie` header actually carries the session cookie.
 *
 * Name-boundary aware on purpose: a bare `includes()` would match a DIFFERENT
 * cookie whose name merely ends with ours (`x__Host-ds_session`) or whose VALUE
 * happens to contain the string, and would then hand a cookie-less request to
 * the BFF as if it were authenticated.
 */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

/**
 * The incoming request's fingerprint surface the authenticated read must forward.
 * The BFF session is **fingerprint-bound** (ADR-0001 §6 / 003 design §3:
 * `hash(user-agent + IP/24 + accept-language)`) — the api re-derives the
 * fingerprint on every read and rejects a cookie whose surface diverges from the
 * one bound at login. A server-to-server SSR read on the doctor's behalf must
 * therefore present the same `user-agent`, `accept-language` AND source address
 * as the browser, not just the cookie.
 *
 * The source address is `forwardedFor`, and it is the reason this surface has
 * four fields rather than three: since #1655 the api runs behind
 * `FastifyAdapter({ trustProxy })`, so `request.ip` is the leftmost UNTRUSTED
 * entry of `x-forwarded-for` — the real browser — whenever the peer is inside the
 * trusted set. The login therefore binds the BROWSER's IP/24, while an SSR read
 * that builds its own request resolves to the storefront CONTAINER's address
 * (172.18.0.x) and 401s a valid session (#2054). Relaying the chain Caddy already
 * appended restores the bound address; the container is itself trusted, so the api
 * honours the header it relays.
 */
export interface ForwardedSession {
  cookie: string;
  userAgent: string;
  acceptLanguage: string;
  /** The incoming `x-forwarded-for` value verbatim; `""` when there was none. */
  forwardedFor: string;
}

/**
 * THE canonical builder for that surface — one place both storefronts read the
 * incoming request through, so a fifth fingerprint input can never be added to
 * one host and forgotten on the other (which is exactly how #2054 happened).
 *
 * Total by design: an anonymous visitor yields `cookie: ""` rather than `null`,
 * because not every consumer is an authenticated read — the public participation
 * CTA issues its request for guest and doctor alike and simply carries no session
 * surface. The name-boundary check still decides what counts as a session: a
 * cookie header without OUR cookie is anonymous, so callers guarding on
 * `!session.cookie` never issue an authed read on a decoy cookie.
 */
export function forwardedSessionFrom(headers: Headers): ForwardedSession {
  const cookie = headers.get("cookie");
  return {
    cookie: hasSessionCookie(cookie) ? (cookie as string) : "",
    userAgent: headers.get("user-agent") ?? "",
    acceptLanguage: headers.get("accept-language") ?? "",
    forwardedFor: headers.get("x-forwarded-for") ?? "",
  };
}

/**
 * The request headers every server-to-server BFF hop sends: `accept`, plus the
 * session cookie and its fingerprint surface when a session actually rode the
 * request.
 *
 * `x-forwarded-for` is emitted ONLY when the incoming request carried one. Local
 * dev has no proxy in front of Next: with the header absent the api falls back to
 * the socket peer, which IS the same loopback address the browser's login rode
 * through — synthesising a value there would break the very fingerprint this
 * function exists to preserve.
 */
export function forwardedHeaders(
  session: ForwardedSession,
): Record<string, string> {
  return {
    accept: "application/json",
    // The session surface only when a session actually rode the request: a guest
    // read carries no cookie and no fingerprint headers to re-derive from.
    ...(session.cookie
      ? {
          cookie: session.cookie,
          "user-agent": session.userAgent,
          "accept-language": session.acceptLanguage,
        }
      : {}),
    // The client chain rides EVERY hop, authed or not — `request.ip` also keys
    // the api's rate-limit windows (#1655 EARS-13), and an SSR read that hides
    // the client behind the container address pools every visitor into one
    // bucket.
    ...(session.forwardedFor
      ? { "x-forwarded-for": session.forwardedFor }
      : {}),
  };
}

/**
 * Read the calling doctor's registration state for `idOrSlug`, forwarding the
 * incoming request's session cookie AND its fingerprint headers so the api
 * resolves + re-derives the `__Host-` session server-side. Returns:
 *   • `{ registered, registeredAt? }` for an authenticated caller;
 *   • `null` when the caller is unauthenticated (401 — a guest / a fingerprint
 *     mismatch), the cookie header is empty, or the event is not found (404) —
 *     every "no per-user state to compose" case collapses to `null`, and the page
 *     falls back to 004's public render.
 *
 * Per-user ⇒ never shared-cacheable: `cache: "no-store"` keeps this read out of
 * the data cache that backs the public projection (design §5).
 *
 * `fetchImpl` is injected by tests only — production callers pass nothing.
 */
export async function fetchEventRegistrationState(
  idOrSlug: string,
  session: ForwardedSession,
  fetchImpl: typeof fetch = fetch,
): Promise<EventRegistrationState | null> {
  // No session cookie rode the request → a guest; never issue the authed read.
  if (!session.cookie) return null;

  const res = await fetchImpl(
    `${API_BASE}/v1/events/${encodeURIComponent(idOrSlug)}/registration`,
    {
      // The full fingerprint surface (ADR-0001 §6) — without it the api
      // re-derives a different fingerprint and 401s a valid session.
      headers: forwardedHeaders(session),
      // Per-user, authenticated — MUST NOT be shared-cached (design §5).
      cache: "no-store",
    },
  );
  // 401 (guest / expired), 404 (unknown event) → no state to compose; fall back
  // to the public render rather than surfacing an error on the public page.
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`registration state fetch failed (${res.status})`);
  }
  return (await res.json()) as EventRegistrationState;
}
