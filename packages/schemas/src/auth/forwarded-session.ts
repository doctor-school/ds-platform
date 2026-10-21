/**
 * The forwarded-session surface — the ONE declaration every server-to-server BFF
 * hop on either storefront reads the incoming request through (#2073 wave-4
 * gate D5; formerly owned by `@ds/events-storefront` and mirrored by
 * `@ds/room`, #2054).
 *
 * It lives here because `@ds/schemas` is the one workspace node below every
 * consumer (`@ds/events-storefront`, `@ds/auth-flow`, `@ds/room`,
 * `@ds/room-page`, `@ds/event-page`): no consumer may import another's copy, so
 * a shape declared anywhere higher had to be mirrored, and a fifth fingerprint
 * input could be added to one copy and forgotten on the other — exactly how
 * #2054 happened. Pure on purpose: `Headers` in, plain object out, no framework
 * import.
 */

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
 * The incoming request's fingerprint surface an authenticated read must forward.
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
 * The one capability `forwardedSessionFrom` needs of the incoming request's
 * headers. A Fetch `Headers` (what Next's `headers()` and a `Request` hand out)
 * satisfies it structurally; it is declared here because this package compiles
 * against `ES2022` alone, with no DOM or Node typings.
 */
export interface IncomingHeaders {
  get(name: string): string | null;
}

/**
 * THE canonical builder for that surface — one place both storefronts read the
 * incoming request through.
 *
 * Total by design: an anonymous visitor yields `cookie: ""` rather than `null`,
 * because not every consumer is an authenticated read — the public participation
 * CTA issues its request for guest and doctor alike and simply carries no session
 * surface. The name-boundary check still decides what counts as a session: a
 * cookie header without OUR cookie is anonymous, so callers guarding on
 * `!session.cookie` never issue an authed read on a decoy cookie.
 */
export function forwardedSessionFrom(
  headers: IncomingHeaders,
): ForwardedSession {
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
 *
 * `session.cookie` is caller-overridable ON PURPOSE: a session-free public read
 * (the doctor event page / live strip) spreads `forwardedSessionFrom(headers)`
 * and then replaces `cookie` with a narrower or empty value. This function only
 * tests the cookie for presence and never re-validates its name — tightening
 * that would silently drop those reads' cookies.
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
