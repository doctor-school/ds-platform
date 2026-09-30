import { parseSameOriginReturnTarget } from "@ds/schemas";

import { RETURN_TARGET_PARKING } from "../host-config";

/**
 * The CONSUMPTION half of the platform-wide return-to-origin mechanism (014
 * EARS-6 / design S6), owned once for both storefronts (#2027 PR 1.4, rows
 * 29-31).
 *
 * The writing half is `@ds/auth-flow/server` parkReturnTarget; this is the half
 * that runs in the browser, which is the whole reason the codec is split across
 * two subpaths: the parked value is read from `document.cookie` by the auth
 * success handler, so it cannot live behind `./server`.
 *
 * Two invariants the design pins, both enforced here:
 *
 *   - Consume exactly once, then clear. {@link resolveReturnTarget} is the
 *     single consumption point and always clears the parked target, whether it
 *     used it or the query value won. A later, unrelated sign-in can therefore
 *     never teleport the visitor into a stale page.
 *   - Never an open redirect. Nothing leaves this module unvalidated. Both the
 *     query value and the parked cookie are re-checked through the `@ds/schemas`
 *     same-origin guard at the moment of use, so a target tampered with in
 *     transit - a hand-edited cookie is exactly as trusted as a hand-edited
 *     query string, which is to say not at all - is dropped in favour of the
 *     surface default landing.
 *
 * The cookie NAME is the package `RETURN_TARGET_PARKING` declaration, the same
 * one the server rule writes through, never a second literal here: two literals
 * would be two places the halves could disagree. It is the same on both
 * storefronts (row 29, #2443).
 */

/**
 * Read the parked return target, or `null` when there is none, it is unreadable,
 * or it does not survive the same-origin guard.
 * Browser-only: on the server there is no `document`, and the answer is `null`.
 */
export function readStoredReturnTarget(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${RETURN_TARGET_PARKING.name}=`;
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (raw === undefined || raw.length === 0) return null;
  // The cookie serializer percent-encodes the value; a malformed escape is
  // simply a target we refuse to reconstruct.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Re-validated at the moment of use - the parked value is never trusted
  // because it was validated once when it was written.
  return parseSameOriginReturnTarget(decoded);
}

/**
 * Drop the parked return target. Idempotent; a no-op on the server.
 */
export function clearStoredReturnTarget(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${RETURN_TARGET_PARKING.name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Resolve the return target to land on after a successful authentication, and
 * consume it: the still-present query value wins over the parked one (it is the
 * more recent intent), and the parked target is cleared EITHER WAY so it can be
 * consumed exactly once (014 design S6).
 *
 * Returns `null` when no valid target exists - the caller then uses its own
 * default landing, which is a default and never an override of a present target.
 */
export function resolveReturnTarget(
  rawFromQuery: string | null,
): string | null {
  const fromQuery = parseSameOriginReturnTarget(rawFromQuery);
  // The parked fallback stays as the in-flow safety net (014 EARS-6, amendment
  // 2026-09-30 «a carried return target lives only inside the flow that carried
  // it», #2495). Why keep it: should an in-flow hop ever lose the query, the
  // flow still lands on its own guard-validated target instead of silently
  // dropping the visitor's registration; outside a flow a bare door has already
  // expired the cookie, so it cannot resurrect an abandoned flow.
  const parked = readStoredReturnTarget();
  clearStoredReturnTarget();
  return fromQuery ?? parked;
}
