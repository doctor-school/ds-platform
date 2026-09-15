import type { ShellAuthState } from "@ds/storefront-shell";

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
  // No session cookie rode the request → a guest; never issue the upstream read.
  if (!session.cookie) return { status: "guest" };

  try {
    const claims = await fetchSessionClaims(session, fetchImpl);
    return claims ? { status: "doctor" } : { status: "guest" };
  } catch {
    return { status: "guest" };
  }
}

/** The ONE guest control of the canvas (`ds-shell.dc.html` line 220) — a single
 *  combined label on both hosts (017 US-7), opening the shipped `/login`
 *  surface, which carries the way on to `/register`. */
const GUEST_LABEL = "Войти / Регистрация";
/** The signed-in affordance the doctor storefront ships — a LABELLED chip
 *  (canvas lines 192/209), not the academy's initials square: this host has no
 *  display-name read in the header and 017 EARS-1 asserts the words. */
const DOCTOR_LABEL = "Личный кабинет";

/**
 * 017 EARS-1 — project the server-resolved {@link ShellAuth} onto the shared
 * chrome's data prop.
 *
 * This is the whole of the doctor host's auth-cluster ownership since #2180:
 * WHERE the session is read (here, on the server, before the first byte) and
 * WHICH copy the chip carries. The chip itself — geometry, surface, press chain
 * — belongs to `@ds/storefront-shell`, so it cannot drift from the academy's.
 * Omitting `initials` is what selects the labelled chip over the initials one.
 */
export function shellAuthState(auth: ShellAuth): ShellAuthState {
  return auth.status === "doctor"
    ? { status: "doctor", profileHref: "/account", label: DOCTOR_LABEL }
    : { status: "guest", loginHref: "/login", label: GUEST_LABEL };
}
