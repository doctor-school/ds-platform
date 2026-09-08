import type { SessionClaims } from "@ds/schemas";
import {
  forwardedHeaders,
  type ForwardedSession,
} from "@ds/events-storefront/server";

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
 * on the doctor's behalf must present the same `user-agent`, `accept-language`
 * AND client address the browser bound at login, or the api re-derives a
 * different fingerprint and 401s an otherwise valid session. Per-caller ⇒
 * `cache: "no-store"`, never shared.
 *
 * The surface itself and its builder are NOT declared here: both storefronts run
 * the identical hop, so a second copy is a second place for a fingerprint input
 * to be forgotten — which is exactly how #2054 reached production. The canon is
 * `@ds/events-storefront/server`; this module re-exports it so this host's
 * readers keep addressing it by one local name.
 */

export {
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  type ForwardedSession,
} from "@ds/events-storefront/server";

/**
 * Same-origin BFF upstream (Next rewrites `/v1/*` here — see next.config.ts).
 *
 * Exported because every SERVER-side read of this app must address the api by
 * the same base: a second copy of this expression elsewhere in `lib/` would be a
 * second place to change when the upstream moves, and the two could disagree.
 * Browser-side reads stay RELATIVE and go through the rewrite instead.
 */
export const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

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
    // The whole fingerprint surface (ADR-0001 §6), forwarded client address
    // included — without it the api 401s a valid session (#2054).
    headers: forwardedHeaders(session),
    cache: "no-store",
  });

  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`session fetch failed (${res.status})`);
  return (await res.json()) as SessionClaims;
}
