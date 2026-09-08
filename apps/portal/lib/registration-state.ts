import type { EventRegistrationState } from "@ds/schemas";

import type { CanvasStatus } from "./event-lifecycle";
import { buildRoomReturnHref } from "./room-return";

/**
 * 005 EARS-4/EARS-5 — the Academy's per-user layer over the 004 event page.
 *
 * The READ itself moved to `@ds/events-storefront/server`: both storefronts
 * compose the same per-user `EventRegistrationState` onto the same shared event
 * page (020 EARS-1), so the fetch, its fingerprint forwarding (ADR-0001 §6) and
 * its `null` collapse must not be able to drift between hosts. It is re-exported
 * here so this host's readers (`lib/event-playback`, `lib/my-events`,
 * `lib/participation-cta`) keep addressing the session surface by one name.
 *
 * What stays HERE is the render decision this host layers on top: the join
 * signpost and the room-entry href, both of which read the Academy's own
 * lifecycle (`lib/event-lifecycle`) and route table (`lib/room-return`).
 */
export {
  type ForwardedSession,
  fetchEventRegistrationState,
} from "@ds/events-storefront/server";

/**
 * 005 EARS-5 — the registered doctor's join-signpost render mode: HOW/WHEN they
 * will join, layered on top of the 004 lifecycle render (`lib/event-lifecycle`).
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

/**
 * 006 EARS-6 — the registered-live room front door on the event page. The room
 * surface (`/webinars/:slug/room`) shipped in EARS-1..7, so the entry CTA that was
 * deliberately deferred to #584 (rendering a `/room` link before the room existed
 * would have dead-ended in a 404 — the #673 Stage-B finding) is now restored.
 *
 * The pure state→href decision: exactly when the caller is registered AND the event
 * is `live` (the `live` arm of {@link resolveJoinSignpost} — the same condition the
 * room gate admits them under server-side), return the canonical same-origin room
 * path; every other case (registered on a non-live event, unregistered, or a guest)
 * returns `null` and no room link renders. The href is built through the hardened
 * {@link buildRoomReturnHref} so a hostile slug can never front a cross-origin or
 * protocol-relative target.
 */
export function resolveRoomEntryHref(
  state: EventRegistrationState | null,
  status: CanvasStatus,
  slug: string,
): string | null {
  return resolveJoinSignpost(state, status).kind === "live"
    ? buildRoomReturnHref(slug)
    : null;
}
