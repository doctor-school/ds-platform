"use client";

import { parseDoctorEventReturnTarget } from "@ds/schemas";
import type { ReturnHost } from "@ds/events-storefront";

/**
 * 005 EARS-2 on doctor.school — the DOCTOR HOST'S PROJECTION of the one shared
 * completion-on-return rule.
 *
 * The rule itself (which branch wins, when `RegisterForEvent` fires, what a
 * carried target may never become) lives once in
 * `@ds/events-storefront` `completeReturnTarget` and is the Academy's rule
 * verbatim — this file adds only what a host may add: which return shapes count
 * as THIS storefront's own, and where a visitor who carried nothing lands. No
 * doctor-local decision rule, no second guard: the shapes come from
 * `@ds/schemas` (registry row «Registration return / `returnTo`»), the rule from
 * the package (row «Event registration one-tap + completion-on-return»).
 *
 * THE INTENT SHAPE is `parseDoctorEventReturnTarget` — `/events/<slug>`, this
 * host's own event page — never the canonical academy `/webinars/<slug>` the
 * gate emits. The auth routes hand this rule the projection they already
 * resolved server-side (`lib/return-context.ts` `resolveReturnLandingPath`,
 * #1945), so the raw param is guarded, projected and only then completed.
 *
 * NO ROOM-RETURN SHAPE ON THIS HOST. The academy carries `/webinars/<slug>/room`
 * through auth (006 EARS-6) because its room bounces an unauthenticated visitor
 * into the login flow. The doctor room does not: every EARS-6 refusal —
 * `auth`, `register`, `notLive` — lands on THIS host's event page instead
 * (`app/(room)/events/[slug]/room/room-routes.ts`, 020 §6.1 D10 / ADR-0015 §4
 * REQ-24), so no room url ever rides a `returnTo` here and there is nothing for
 * the room branch to recognise. `parseRoomReturn` is therefore the honest `null`
 * the package's {@link ReturnHost} documents for a host that carries no room
 * return — not a stub standing in for a missing parser. Should the doctor room
 * ever start routing its refusals through `/login?returnTo=…`, this is the one
 * line that has to learn the shape.
 */
export function doctorReturnHost(defaultLanding: string): ReturnHost {
  return {
    parseRoomReturn: () => null,
    parseIntent: parseDoctorEventReturnTarget,
    defaultLanding,
  };
}
