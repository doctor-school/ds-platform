import { parseSameOriginReturnTarget } from "@ds/schemas";

/**
 * 014 EARS-6 — the portal half of the platform-wide return-to-origin mechanism
 * (014 design §6).
 *
 * The query string already carries a `returnTo` from a gated surface into the auth
 * entry (`/login?returnTo=…`, `/register?returnTo=…`) and onward through the flow
 * (`withReturnTarget`). That carry is enough for an uninterrupted round-trip — but
 * NOT for the registration branch, which leaves the browser: the verification mail
 * lands the visitor on a COLD `/verify#email=…` with no query at all. Design §6
 * requires the target to survive exactly that interruption, so the validated
 * target is ALSO parked in a short-lived, same-origin cookie when the visitor
 * enters the auth flow (written server-side by `middleware.ts`), and read back
 * here when no query target is present.
 *
 * Two invariants the design pins, both enforced in this module:
 *
 *   • **Consume exactly once, then clear.** {@link resolveReturnTarget} is the
 *     single consumption point and always clears the parked target, whether it
 *     used it or the query value won. A later, unrelated sign-in therefore can
 *     never teleport the visitor into a stale page.
 *   • **Never an open redirect.** Nothing leaves this module unvalidated. Both the
 *     query value and the parked cookie are re-checked through the `@ds/schemas`
 *     `parseSameOriginReturnTarget` guard at the moment of use, so a target that
 *     was tampered with in transit (a hand-edited cookie is exactly as trusted as
 *     a hand-edited query string — that is, not at all) is dropped in favour of
 *     the surface's default landing. The cookie carries no signature because it
 *     carries no privilege: it is a page path, and the guard, not a signature, is
 *     the defence that makes following it safe.
 */

/**
 * The cookie the validated return target is parked in. Same-origin, `Lax`, and
 * deliberately NOT `HttpOnly`: the consumption point is the client-side auth
 * success handler (`completeReturnTarget`), which must both read and clear it.
 */
export const RETURN_TARGET_COOKIE = "ds_return_to";

/**
 * How long a parked target stays valid — long enough to open a verification mail
 * and come back, short enough that an abandoned flow does not resurface days
 * later on an unrelated sign-in.
 */
export const RETURN_TARGET_MAX_AGE_SECONDS = 900;

/**
 * Read the parked return target, or `null` when there is none, it is unreadable,
 * or it does not survive the same-origin guard. Browser-only: on the server (SSR)
 * there is no `document`, and the answer is `null`.
 */
export function readStoredReturnTarget(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${RETURN_TARGET_COOKIE}=`;
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (raw === undefined || raw.length === 0) return null;
  // The cookie serializer percent-encodes the value; a malformed escape is simply
  // a target we refuse to reconstruct.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Re-validated at the moment of use — the parked value is never trusted because
  // it was validated once when it was written.
  return parseSameOriginReturnTarget(decoded);
}

/** Drop the parked return target. Idempotent; a no-op on the server. */
export function clearStoredReturnTarget(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${RETURN_TARGET_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Resolve the return target to land on after a successful authentication, and
 * consume it: the still-present query value wins over the parked one (it is the
 * more recent intent), and the parked target is cleared EITHER WAY so it can be
 * consumed exactly once (014 design §6).
 *
 * Returns `null` when no valid target exists — the caller then uses its own
 * default landing, which is a default and never an override of a present target.
 */
export function resolveReturnTarget(rawFromQuery: string | null): string | null {
  const fromQuery = parseSameOriginReturnTarget(rawFromQuery);
  const parked = readStoredReturnTarget();
  clearStoredReturnTarget();
  return fromQuery ?? parked;
}
