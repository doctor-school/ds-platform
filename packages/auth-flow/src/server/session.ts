import type { SessionClaims } from "@ds/schemas";
import { forwardedHeaders, forwardedSessionFrom } from "@ds/events-storefront/server";
import type { ForwardedSession } from "@ds/events-storefront/server";

/**
 * The ONE server-side session read of the shared auth flow (wave-1 gate rows
 * 22-25, #2027 PR 1.4).
 *
 * Four facts used to live in three places - the Academy app-shell read, the
 * doctor host `lib/session.ts` and its `lib/shell-auth.ts` - and this subpath is
 * the ONE address the whole platform now reads them through:
 *
 *   - rows 22-23 (the cookie name, the name-boundary test and the
 *     fingerprint-bound header surface) are DECLARED once in
 *     `@ds/events-storefront/server` and re-exported below - see that block for
 *     why the declaration stays there;
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

/**
 * Rows 22-23 live in `@ds/events-storefront/server` and are RE-EXPORTED here.
 *
 * The declaration itself stays where the dependency graph allows it to stay: the
 * tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §4 lets
 * `@ds/auth-flow` depend on `@ds/events-storefront` and NOT the other way round,
 * so moving the cookie name and the fingerprint surface up into this package
 * would have inverted an approved edge (the `package-import-boundary` guard
 * fails on it). Re-exporting satisfies the same requirement the move was after —
 * ONE declaration on the platform, read through the auth-flow address by every
 * auth consumer — without touching the graph.
 *
 *   - row 22: ONE session-cookie name. `__Host-` prefixed, which by
 *     specification carries NO `Domain` attribute and is therefore locked to the
 *     exact origin that set it. `doctor.school` and `academy.doctor.school` are
 *     different origins and hold SEPARATE session cookies of the SAME name
 *     (ADR-0015 S4); continuity between the storefronts is OIDC silent re-auth
 *     against the one Zitadel identity, never a shared cookie.
 *   - row 23: ONE bound-surface header set (`ForwardedSession`,
 *     `forwardedSessionFrom`, `forwardedHeaders`). The BFF session is
 *     fingerprint-bound (ADR-0001 S6 / 003 design S3:
 *     hash(user-agent + IP/24 + accept-language)), so a server-to-server read on
 *     the doctor behalf must present the same surface the browser bound at
 *     login. A second copy of that builder is a second place for a fingerprint
 *     input to be forgotten - which is exactly how #2054 reached production, and
 *     the reason no copy of it is made here.
 *
 * `hasSessionCookie` rides along because rows 22-24 are one contract: the
 * name-boundary test is what decides that a cookie header actually carries OUR
 * session.
 */
export {
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  type ForwardedSession,
} from "@ds/events-storefront/server";

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
