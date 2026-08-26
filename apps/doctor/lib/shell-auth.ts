import { fetchSessionClaims, forwardedSessionFrom } from "@/lib/session";

/**
 * 017 EARS-1 — the sign-in status the storefront shell branches its action
 * cluster on, resolved on the SERVER.
 *
 * Server-resolved is the requirement, not an optimisation: EARS-1 forbids a
 * transitional state ever being visible to the doctor, so the cluster must be
 * decided before the first byte of HTML — never a client `useEffect` that paints
 * the guest cluster and swaps it (the portal's `lib/header-auth.ts` does exactly
 * that for its own app-shell, and mirroring the RESULT here rather than the
 * mechanism is deliberate; no portal code is imported, ADR-0015 §2).
 *
 * The read reuses the app's ONE auth mechanism — the `__Host-ds_session` cookie
 * plus the fingerprint headers of `lib/session.ts` (ADR-0015 §4, ADR-0001 §6).
 * No second auth path is introduced.
 */
export type ShellAuth = { status: "guest" } | { status: "doctor" };

/**
 * Resolve the cluster branch from an incoming request's headers.
 *
 * Three paths, all landing on exactly one cluster (never "neither"):
 *   • no session cookie          → `guest`, with NO upstream read at all;
 *   • cookie present, api 401    → `guest` (expired/invalid session);
 *   • cookie present, api 200    → `doctor`.
 *
 * A non-401 upstream failure also degrades to `guest`: the shell wraps every
 * doctor-facing route, so a flaky session read must never take a whole page
 * down. The worst case is a guest cluster shown to a signed-in doctor — an
 * affordance that still leads back in — rather than a 500 on the storefront.
 *
 * `fetchImpl` is injected by tests; production callers pass nothing.
 */
export async function resolveShellAuth(
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellAuth> {
  const session = forwardedSessionFrom(headers);
  if (!session) return { status: "guest" };

  try {
    const claims = await fetchSessionClaims(session, fetchImpl);
    return claims ? { status: "doctor" } : { status: "guest" };
  } catch {
    return { status: "guest" };
  }
}
