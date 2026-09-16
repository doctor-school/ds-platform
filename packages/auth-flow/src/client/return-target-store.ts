import { parseSameOriginReturnTarget } from "@ds/schemas";

import type { ReturnTargetParking } from "../return-target";

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
 * The cookie NAME is the host `returnTo.parkingCookie` declaration, the same one
 * the server rule writes through, never a constant here: a package literal would
 * be a second place the two halves could disagree. `undefined` parking is row
 * 29, the doctor storefront, which parks nothing and therefore reads nothing -
 * its target rides the query param alone.
 */

/**
 * Read the parked return target, or `null` when there is none, it is unreadable,
 * it does not survive the same-origin guard, or this host parks nothing.
 * Browser-only: on the server there is no `document`, and the answer is `null`.
 */
export function readStoredReturnTarget(
  parking: ReturnTargetParking | undefined,
): string | null {
  if (!parking) return null;
  if (typeof document === "undefined") return null;
  const prefix = `${parking.name}=`;
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
 * Drop the parked return target. Idempotent; a no-op on the server and on a host
 * that parks nothing (which must never clear another host cookie of its own
 * accord).
 */
export function clearStoredReturnTarget(
  parking: ReturnTargetParking | undefined,
): void {
  if (!parking) return;
  if (typeof document === "undefined") return;
  document.cookie = `${parking.name}=; Path=/; Max-Age=0; SameSite=Lax`;
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
  parking: ReturnTargetParking | undefined,
): string | null {
  const fromQuery = parseSameOriginReturnTarget(rawFromQuery);
  const parked = readStoredReturnTarget(parking);
  clearStoredReturnTarget(parking);
  return fromQuery ?? parked;
}
