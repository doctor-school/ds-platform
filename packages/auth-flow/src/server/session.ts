import type { SessionClaims } from "@ds/schemas";

/**
 * The ONE server-side session read of the shared auth flow (wave-1 gate rows
 * 22-25, #2027 PR 1.4).
 *
 * Four facts used to live in three places - the Academy app-shell read, the
 * doctor host `lib/session.ts` and its `lib/shell-auth.ts` - and this module is
 * where they now live exactly once:
 *
 *   - row 22: ONE session-cookie name. `__Host-` prefixed, which by
 *     specification carries NO `Domain` attribute and is therefore locked to the
 *     exact origin that set it. `doctor.school` and `academy.doctor.school` are
 *     different origins and hold SEPARATE session cookies of the SAME name
 *     (ADR-0015 S4); continuity between the storefronts is OIDC silent re-auth
 *     against the one Zitadel identity, never a shared cookie. The host is not
 *     an authorization boundary either way - the api re-checks roles on every
 *     request.
 *   - row 23: ONE bound-surface header set. The BFF session is
 *     fingerprint-bound (ADR-0001 S6 / 003 design S3:
 *     hash(user-agent + IP/24 + accept-language)), so a server-to-server read on
 *     the doctor behalf must present the same surface the browser bound at
 *     login, or the api re-derives a different fingerprint and 401s a valid
 *     session. A second copy of this builder is a second place for a fingerprint
 *     input to be forgotten - which is exactly how #2054 reached production.
 *   - row 24: ONE guest short-circuit. No session cookie on the request means
 *     guest, with NO upstream read at all.
 *   - row 25: ONE degrade-to-guest rule. A 401 is a guest; so is a failed read.
 *     The result feeds the shell auth cluster, which wraps every route of both
 *     storefronts, so a flaky session read must never take a page down. The
 *     worst case is a guest cluster shown to a signed-in doctor - an affordance
 *     that still leads back in - rather than a 500 on the storefront.
 *
 * Server-side by contract, which is why it lives behind the `./server` subpath:
 * nothing here touches `document`, and the cluster has to be decided before the
 * first byte of HTML (017 EARS-1 forbids a transitional state ever being visible
 * to the doctor).
 */

/** Row 22 - the BFF session cookie name. `__Host-` = origin-locked, no `Domain`. */
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
 * Row 23 - the incoming request fingerprint surface an authenticated read must
 * forward.
 *
 * The source address is `forwardedFor`, and it is the reason this surface has
 * four fields rather than three: since #1655 the api runs behind
 * `FastifyAdapter({ trustProxy })`, so `request.ip` is the leftmost UNTRUSTED
 * entry of `x-forwarded-for` - the real browser - whenever the peer is inside
 * the trusted set. The login therefore binds the BROWSER IP/24, while an SSR
 * read that builds its own request resolves to the storefront CONTAINER address
 * (172.18.0.x) and 401s a valid session (#2054). Relaying the chain the edge
 * already appended restores the bound address; the container is itself trusted,
 * so the api honours the header it relays.
 */
export interface ForwardedSession {
  cookie: string;
  userAgent: string;
  acceptLanguage: string;
  /** The incoming `x-forwarded-for` value verbatim; `""` when there was none. */
  forwardedFor: string;
}

/**
 * THE canonical builder for that surface - one place both storefronts read the
 * incoming request through.
 *
 * Total by design: an anonymous visitor yields `cookie: ""` rather than `null`,
 * because not every consumer is an authenticated read - a public participation
 * CTA issues its request for guest and doctor alike and simply carries no
 * session surface. The name-boundary check still decides what counts as a
 * session, so a caller guarding on `!session.cookie` never issues an authed read
 * on a decoy cookie.
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
 * dev has no proxy in front of Next: with the header absent the api falls back
 * to the socket peer, which IS the same loopback address the browser login rode
 * through - synthesising a value there would break the very fingerprint this
 * function exists to preserve.
 *
 * `session.cookie` is caller-overridable ON PURPOSE: a session-free public read
 * spreads `forwardedSessionFrom(headers)` and then replaces `cookie` with a
 * narrower or empty value. This function only tests the cookie for presence and
 * never re-validates its name - tightening that would silently drop those reads
 * cookies.
 */
export function forwardedHeaders(
  session: ForwardedSession,
): Record<string, string> {
  return {
    accept: "application/json",
    ...(session.cookie
      ? {
          cookie: session.cookie,
          "user-agent": session.userAgent,
          "accept-language": session.acceptLanguage,
        }
      : {}),
    // The client chain rides EVERY hop, authed or not - `request.ip` also keys
    // the api rate-limit windows (#1655 EARS-13), and an SSR read that hides the
    // client behind the container address pools every visitor into one bucket.
    ...(session.forwardedFor
      ? { "x-forwarded-for": session.forwardedFor }
      : {}),
  };
}

/**
 * The same-origin BFF upstream every SERVER-side read addresses (each host Next
 * config rewrites `/v1/*` here). Browser-side reads stay RELATIVE and go through
 * that rewrite instead.
 *
 * A FUNCTION rather than a module constant: a package constant would freeze the
 * value at import time, which on a host that reads its environment later - or in
 * a test that sets it per case - is the wrong value with no way to correct it.
 * Evaluating per call costs nothing and cannot go stale.
 */
export function serverApiBase(): string {
  return (process.env.API_PROXY_TARGET ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/**
 * Read the authenticated principal (`sub, roles[], mfa`) server-side.
 *
 * `null` on 401 (no/expired session) rather than a throw, so a caller can branch
 * guest-vs-doctor without try/catch; a non-401 failure IS an error and throws -
 * {@link resolveServerAuth} is where that error becomes the row-25 degrade, so a
 * caller that genuinely wants to know stays able to.
 *
 * `fetchImpl` is injected for tests - production callers pass nothing.
 * Per-caller, so `cache: "no-store"`, never shared.
 */
export async function fetchSessionClaims(
  session: ForwardedSession,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionClaims | null> {
  const res = await fetchImpl(`${serverApiBase()}/v1/auth/session`, {
    headers: forwardedHeaders(session),
    cache: "no-store",
  });

  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`session fetch failed (${res.status})`);
  return (await res.json()) as SessionClaims;
}

/**
 * Rows 24-25 - the resolved server-side auth state both storefronts branch on.
 *
 * The claims ride along because a second read to recover what this one already
 * fetched would be a second fingerprint hop. What the projection to
 * `ShellAuthState` says - which copy the chip carries, which href it points at -
 * stays host data: the doctor storefront ships a labelled chip and the Academy
 * an initials square, and that is the one honest difference between them.
 */
export type ServerAuth =
  | { status: "guest" }
  | { status: "doctor"; claims: SessionClaims };

/**
 * Resolve the branch from an incoming request headers. Three paths, all landing
 * on exactly one cluster (never "neither"):
 *   - no session cookie:       `guest`, with NO upstream read at all (row 24);
 *   - cookie present, api 401: `guest` (expired/invalid session, row 25);
 *   - cookie present, api 200: `doctor`.
 *
 * A non-401 upstream failure also degrades to `guest` (row 25).
 * `fetchImpl` is injected by tests; production callers pass nothing.
 */
export async function resolveServerAuth(
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<ServerAuth> {
  const session = forwardedSessionFrom(headers);
  if (!session.cookie) return { status: "guest" };

  try {
    const claims = await fetchSessionClaims(session, fetchImpl);
    return claims ? { status: "doctor", claims } : { status: "guest" };
  } catch {
    return { status: "guest" };
  }
}
