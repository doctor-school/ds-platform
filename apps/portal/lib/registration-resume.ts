"use client";

import { parseAcademyEventReturnTarget } from "@ds/schemas";
import {
  type ReturnHost,
  completeReturnTarget as completeSharedReturnTarget,
} from "@ds/events-storefront";

import { resolveReturnTarget } from "./return-to-origin";
import { parseRoomReturnTarget } from "./room-return";

/**
 * 005 EARS-2 — the ACADEMY projection of the shared completion-on-return rule.
 *
 * The rule itself — room return before event intent, best-effort
 * `RegisterForEvent`, any other safe same-origin page honoured as-is, default
 * landing otherwise — lives ONCE in `@ds/events-storefront`, because
 * `doctor.school` completes the same round-trip on its own routes (020 EARS-1).
 * What this module owns is the two host-shaped facts the shared rule takes as
 * configuration, plus the CARRY side that cannot be shared:
 *
 *   • the parked-target consume (014 EARS-6, `resolveReturnTarget`) — the store is
 *     per-origin, so each host resolves + clears its own before delegating;
 *   • this host's shapes: the academy `/webinars/<slug>` intent guard and the
 *     `/webinars/<slug>/room` return (006 EARS-6);
 *   • this host's default landing, `/webinars` (008 EARS-7 as amended by 013
 *     EARS-15) — never `/`, which serves the Academy marketing landing and would
 *     strand a doctor on marketing copy after login.
 *
 * The parser being HOST-SCOPED is what keeps the doctor feed's
 * `/events?…&resume=<slug>` (019 EARS-12) from being an intent here: it fires no
 * `RegisterForEvent` and is never treated as an academy event page.
 *
 * Consumers (`/login`, `/register`, `/verify`, `lib/room-return`) keep this import
 * path and this signature — the extraction moved the rule, not the seam.
 */
const ACADEMY_RETURN_HOST: ReturnHost = {
  parseRoomReturn: parseRoomReturnTarget,
  parseIntent: parseAcademyEventReturnTarget,
  defaultLanding: "/webinars",
};

export { currentReturnTarget } from "@ds/events-storefront";

/**
 * Given the raw `returnTo` carried through auth, consume the parked target once
 * (014 EARS-6 — the query value if it is still on the URL, otherwise the target
 * parked when the visitor entered the auth flow, which is how the registration
 * branch survives the trip through the verification mail) and complete the
 * round-trip through the shared rule. Returns WHERE to land.
 */
export async function completeReturnTarget(
  rawReturnTo: string | null,
): Promise<string> {
  // Resolve + consume once. Everything below sees a guard-clean same-origin path
  // or `null`; a hostile value never reaches a navigation.
  return completeSharedReturnTarget(
    resolveReturnTarget(rawReturnTo),
    ACADEMY_RETURN_HOST,
  );
}
