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
 *   • WHICH non-event shape is a legal target — the ACCOUNT FAMILY (row 32,
 *     #1987): the host's own `routes.account` and every page below it.
 *
 * The account shape is declared HERE rather than inside the 005
 * `RETURN_TARGET_SHAPES` whitelist for a structural reason: every member of that
 * list yields a `RegistrationIntent`, whose `eventSlug` a consumer then FIRES
 * `RegisterForEvent` for. The cabinet carries no эфир, so admitting it there
 * would mean minting a slug that names no event — a fake value, not a shape. The
 * account shape is therefore a declared shape of the LANDING codec, held to the
 * same reconstruct-never-echo rule: the value returned is the same-origin
 * guard's own reconstruction, never the visitor's raw string.
 */

/** The host's parking declaration — `undefined` on a host that parks nothing. */
export type ReturnTargetParking = NonNullable<
  AuthFlowReturnToConfig["parkingCookie"]
>;

/**
 * Row 32 / #1987 — the account FAMILY.
 *
 * `null` unless the carried value survives the same-origin guard AND belongs to
 * this host's OWN account family: the configured `routes.account` itself, or any
 * page BELOW it. The boundary is a SEGMENT boundary, so `/accounts` and
 * `/account-evil` — which share the characters and not the segment — are refused.
 *
 * The family is DERIVED from the one value both hosts already declare rather
 * than from a second host-config field or a package literal: a host that serves
 * its cabinet on another path gets its own family by configuration, and no new
 * route table has to be kept in step with the real one.
 *
 * Admitting the family, not just its root, is what closes the lost-behaviour gap
 * the live C6 walk found: a guest bounced off `/account/events` («Мои события»)
 * used to land on the default listing after signing in, because only the exact
 * root was a shape. The value returned is therefore the MATCHED path — the
 * guard's canonical reconstruction of it — and not the configured root, which
 * would round-trip every child page back to the cabinet index.
 */
export function parseAccountReturnTarget(
  returnTo: unknown,
  accountPath: string,
): string | null {
  const safe = parseSameOriginReturnTarget(returnTo);
  if (safe === null) return null;
  // `safe` is the guard's canonical reconstruction: an absolute-path reference
  // with the query and the fragment already stripped, so the boundary test is a
  // plain segment comparison and nothing can be smuggled past it in a query.
  return safe === accountPath || safe.startsWith(`${accountPath}/`)
    ? safe
    : null;
}
