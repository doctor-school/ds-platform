import type { EventRegistrationState } from "@ds/schemas";

import type { CanvasStatus } from "@ds/events-storefront";

/**
 * 005 EARS-4/EARS-5 — the Academy's per-user layer over the 004 event page.
 *
 * The READ itself moved to `@ds/events-storefront/server`: both storefronts
 * compose the same per-user `EventRegistrationState` onto the same shared event
 * page (020 EARS-1), so the fetch, its fingerprint forwarding (ADR-0001 §6) and
 * its `null` collapse must not be able to drift between hosts. It is re-exported
 * here so this host's readers (`lib/event-playback`) keep addressing the session
 * surface by one name.
 *
 * What stays HERE is the render decision this host layers on top: the join
 * signpost, read off the Academy's lifecycle (`toCanvasStatus`,
 * `@ds/events-storefront`). The «Мои события» room href is resolved by the api
 * per host since #1972 (gate §4.3 D8).
 */
export {
  type ForwardedSession,
  fetchEventRegistrationState,
  forwardedHeaders,
  forwardedSessionFrom,
} from "@ds/events-storefront/server";

/**
 * 005 EARS-5 — the registered doctor's join-signpost render mode: HOW/WHEN they
 * will join, layered on top of the 004 lifecycle render (`toCanvasStatus`, `@ds/events-storefront`).
 * The signpost derives from the registration state + the canvas lifecycle
 * `status` — never from the primary CTA (a registered doctor has no register
 * CTA to key off). There are exactly two signpost renders plus the fall-through:
 *
 *   • `upcoming` — the doctor is registered on an `upcoming` (`published`)
 *     event: signpost that they are registered and when the broadcast starts
 *     (date/time МСК). The register CTA is replaced by a static confirmation —
 *     no second action (EARS-4/EARS-5).
 *   • `live` — the doctor is registered on a `live` event: signpost that the
 *     broadcast is on and they are on the participant list. The interactive
 *     onward-to-room affordance is the 006 room surface (#584) — until the room
 *     ships, the signpost is textual (a `/room` link would be a dead link / 404,
 *     a banned pattern; the deferral is tracked on #584).
 *   • `none` — every other case: `ended` / `hidden` (no participation CTA — 004
 *     owns those renders), an unregistered doctor, or a guest (004's register CTA
 *     stands). No signpost is composed onto the public page.
 */
export type JoinSignpost =
  | { readonly kind: "upcoming" }
  | { readonly kind: "live" }
  | { readonly kind: "none" };

export function resolveJoinSignpost(
  state: EventRegistrationState | null,
  status: CanvasStatus,
): JoinSignpost {
  // Only an authenticated, registered caller ever gets a signpost — a guest
  // (null) or an unregistered doctor sees 004's public render unchanged.
  if (state?.registered !== true) return { kind: "none" };
  switch (status) {
    // Upcoming (`published`) → the register CTA is replaced by the confirmation +
    // МСК start signpost.
    case "upcoming":
      return { kind: "upcoming" };
    // Live → the confirmation + "the broadcast is on" signpost (the room link
    // arrives with the 006 room surface, #584).
    case "live":
      return { kind: "live" };
    // `ended` / `hidden` carry no participation CTA — no signpost (004 owns it).
    default:
      return { kind: "none" };
  }
}
