import type { SessionClaims } from "@ds/schemas";

/**
 * Server-side session read for the doctor storefront (`doctor.school`).
 *
 * ADR-0015 §4 is the reason this file exists at all instead of importing the
 * portal's: the BFF session cookie is `__Host-` prefixed, which by specification
 * carries NO `Domain` attribute and is therefore locked to the exact origin that
 * set it. `doctor.school` and `academy.doctor.school` are different origins, so
 * they hold SEPARATE session cookies with the same NAME. Continuity between the
 * two storefronts is OIDC silent re-auth against the one Zitadel identity, never
 * a shared cookie. The host is not an authorization boundary either way — the
 * api re-checks roles on every request.
 *
 * The read forwards BOTH the session cookie AND the fingerprint headers
 * (ADR-0001 §6): the BFF session is fingerprint-bound, so a server-to-server read
 * on the doctor's behalf must present the same `user-agent` + `accept-language`
 * the browser bound at login, or the api re-derives a different fingerprint and
 * 401s an otherwise valid session. Per-caller ⇒ `cache: "no-store"`, never shared.
 */

/** The BFF session cookie name. `__Host-` = origin-locked, no `Domain`. */
export const SESSION_COOKIE_NAME = "__Host-ds_session";

/** The request-scoped surface a server-side BFF read must present. */
export interface ForwardedSession {
  /** Raw `Cookie` header value to replay upstream. */
  cookie: string;
  /** Fingerprint surface, ADR-0001 §6 — must match what was bound at login. */
  userAgent: string;
  acceptLanguage: string;
}

/** Same-origin BFF upstream (Next rewrites `/v1/*` here — see next.config.ts). */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

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
 * Build the forwarded surface from an incoming request's headers, or `null` when
 * there is no session cookie to forward (an anonymous visitor — the caller
 * renders the guest branch and never issues the upstream read).
 */
export function forwardedSessionFrom(
  headers: Headers,
): ForwardedSession | null {
  const cookie = headers.get("cookie");
  if (!hasSessionCookie(cookie)) return null;
  return {
    cookie: cookie as string,
    userAgent: headers.get("user-agent") ?? "",
    acceptLanguage: headers.get("accept-language") ?? "",
  };
}

/**
 * Read the authenticated principal (`sub, roles[], mfa`) server-side.
 *
 * `null` on 401 (no/expired session) rather than a throw, so a caller can branch
 * guest-vs-doctor without try/catch; a non-401 failure IS an error and throws.
 * `fetchImpl` is injected for tests — production callers pass nothing.
 */
export async function fetchSessionClaims(
  session: ForwardedSession,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionClaims | null> {
  const res = await fetchImpl(`${API_BASE}/v1/auth/session`, {
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      // Forward the fingerprint surface (ADR-0001 §6) — without it the api
      // re-derives a different fingerprint and 401s a valid session.
      "user-agent": session.userAgent,
      "accept-language": session.acceptLanguage,
    },
    cache: "no-store",
  });

  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`session fetch failed (${res.status})`);
  return (await res.json()) as SessionClaims;
}
