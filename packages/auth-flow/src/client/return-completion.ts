import {
  parseAcademyEventReturnTarget,
  parseDoctorEventReturnTarget,
  type RegistrationIntent,
} from "@ds/schemas";
import {
  type ReturnHost,
  completeReturnTarget as completeSharedReturnTarget,
} from "@ds/events-storefront";
import { parseRoomReturnTarget } from "@ds/room/room-return";

import type {
  AuthFlowEventPathTemplate,
  AuthFlowHostConfig,
} from "../host-config";
import { resolveReturnTarget } from "./return-target-store";

/**
 * 005 EARS-2 / 014 EARS-6 / wave-1 gate row 39 - the CARRIED-TARGET resolver:
 * where a visitor lands once the door is passed (#2027 PR 1.5; was the Academy
 * host lib/registration-resume.ts).
 *
 * The completion rule itself - room return before event intent, best-effort
 * `RegisterForEvent`, any other safe same-origin page honoured as-is, default
 * landing otherwise - lives once in `@ds/events-storefront`. What this module
 * adds is the CARRY side and the host shapes, all read from the host config:
 *
 *   - the parked-target consume (014 EARS-6): query wins, the parked value is
 *     re-validated and consumed exactly once, from `returnTo.parkingCookie`;
 *   - the room return shape (006 EARS-6) from `routes.room` (absent = no room);
 *   - the event intent guard from `routes.eventPathTemplate` - a closed set, so
 *     each template maps to its host-scoped `@ds/schemas` parser and the doctor
 *     feed `/events?...&resume=<slug>` is never an academy intent;
 *   - the default landing, `landing.afterLogin`.
 *
 * It runs in the BROWSER (the parked target is a same-origin cookie), so it
 * rides on the client subpath, not the server one.
 */
const EVENT_INTENT_PARSERS: Record<
  AuthFlowEventPathTemplate,
  (returnTo: string | null) => RegistrationIntent | null
> = {
  "/webinars/:slug": parseAcademyEventReturnTarget,
  "/events/:slug": parseDoctorEventReturnTarget,
};

type ReturnCompletionHost = Pick<
  AuthFlowHostConfig,
  "routes" | "landing" | "returnTo"
>;

function returnHostOf(
  host: ReturnCompletionHost,
  defaultLanding?: string,
): ReturnHost {
  const { room } = host.routes;
  return {
    parseRoomReturn: (returnTo) =>
      room ? parseRoomReturnTarget(returnTo, { room }) : null,
    parseIntent: EVENT_INTENT_PARSERS[host.routes.eventPathTemplate],
    defaultLanding: defaultLanding ?? host.landing.afterLogin,
  };
}

/**
 * Given the raw `returnTo` carried through auth, consume the parked target once
 * and complete the round-trip through the shared rule. Returns WHERE to land.
 *
 * `defaultLanding` overrides `landing.afterLogin` for THIS completion. A host
 * whose landing is decided on the SERVER per visitor - the doctor storefront's
 * specialty-aware `/events` (`landing.specialtyAware`) - resolves that value
 * before the door renders, and the door hands it straight back here. Absent, the
 * host's static `landing.afterLogin` stands, which is every other caller.
 */
export async function completeReturnTarget(
  host: ReturnCompletionHost,
  rawReturnTo: string | null,
  defaultLanding?: string,
): Promise<string> {
  // Resolve + consume once. Everything below sees a guard-clean same-origin path
  // or `null`; a hostile value never reaches a navigation.
  return completeSharedReturnTarget(
    resolveReturnTarget(rawReturnTo, host.returnTo?.parkingCookie),
    returnHostOf(host, defaultLanding),
  );
}
