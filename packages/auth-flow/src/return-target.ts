import { parseSameOriginReturnTarget } from "@ds/schemas";

import type { AuthFlowReturnToConfig } from "./host-config";

/**
 * The ONE return-target codec of the shared auth flow (wave-1 gate rows 29–32,
 * #2027 PR 1.4).
 *
 * Three facts live here and nowhere else:
 *
 *   • WHAT a safe carried target is — delegated, never restated: the
 *     `@ds/schemas` `parseSameOriginReturnTarget` guard is the single
 *     same-origin rule of the platform (014 EARS-6) and this module re-checks
 *     through it at every moment of use;
 *   • WHERE a host parks one — `returnTo.parkingCookie` host data, `undefined`
 *     on a host that parks nothing (row 29: the doctor storefront carries the
 *     target on the canonical `returnTo` param and has no parking cookie at all);
 *   • WHICH non-event shape is a legal target — `/account` (row 32, #1987).
 *
 * The `/account` shape is declared HERE rather than inside the 005
 * `RETURN_TARGET_SHAPES` whitelist for a structural reason: every member of that
 * list yields a `RegistrationIntent`, whose `eventSlug` a consumer then FIRES
 * `RegisterForEvent` for. `/account` carries no эфир, so admitting it there would
 * mean minting a slug that names no event — a fake value, not a shape. The
 * account shape is therefore a declared shape of the LANDING codec, held to the
 * same reconstruct-never-echo rule: the value returned is the host's own
 * configured `routes.account`, never the visitor's string.
 */

/** The host's parking declaration — `undefined` on a host that parks nothing. */
export type ReturnTargetParking = NonNullable<
  AuthFlowReturnToConfig["parkingCookie"]
>;

/**
 * Row 32 / #1987 — the account shape.
 *
 * `null` unless the carried value survives the same-origin guard AND names this
 * host's OWN account route. The comparison is against `routes.account` (host
 * data) rather than a package literal, so a host that serves its account page on
 * another path is admitted by configuration instead of by a second parser.
 *
 * Returns the CONFIGURED path, not the parsed one: the two are equal by the
 * comparison above, and handing back the host's own constant is what makes it
 * impossible for a visitor-authored string to reach a navigation.
 */
export function parseAccountReturnTarget(
  returnTo: unknown,
  accountPath: string,
): string | null {
  const safe = parseSameOriginReturnTarget(returnTo);
  if (safe === null) return null;
  return safe === accountPath ? accountPath : null;
}
