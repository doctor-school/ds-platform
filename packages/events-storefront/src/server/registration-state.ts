import type { EventRegistrationState } from "@ds/schemas";
import {
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  serverApiBase,
  type ForwardedSession,
} from "@ds/auth-flow/server";

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

/**
 * THE session declaration is no longer here. `@ds/auth-flow/server` owns the
 * cookie name, the name-boundary test, the fingerprint surface and its builder
 * for the whole platform (#2027 PR 1.4): the surface is a fact about the BFF
 * session, not about the event storefront, and it had drifted into three
 * declarations — which is exactly how a fingerprint input gets added in one place
 * and forgotten in another (#2054).
 *
 * The names are RE-EXPORTED rather than merely imported because this module is
 * the address both storefronts' event pages already read them from. Re-pointing
 * every consumer at the same moment as the declaration moved would have buried
 * the move in unrelated diffs; the re-export keeps one declaration and one
 * migration.
 */
export {
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  type ForwardedSession,
};
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
    `${serverApiBase()}/v1/events/${encodeURIComponent(idOrSlug)}/registration`,
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
