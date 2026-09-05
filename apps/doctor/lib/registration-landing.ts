import type { RememberedSpecialty } from "./specialty-choice";

/**
 * 021 EARS-3 (#1539) — LD-4, WHERE A DIRECT ARRIVAL LANDS.
 *
 * EARS-2 (#1538) answered the gated arrival: a doctor who pressed «Участвовать»
 * carries the canonical return target, the surface shows them what they will
 * come back to, and the post-confirmation hop returns them there. EARS-3 is the
 * other half — the doctor who opened `/register` on their own. For them the
 * return context is ABSENT rather than empty (already shipping from #1538: an
 * unresolvable `returnTo` passes `undefined`, so no slot renders at all), and
 * there is by construction nothing to return them to. LD-4 fixes what stands in
 * its place.
 *
 * THE LANDING IS A DECISION ABOUT THE DOCTOR, NOT A CONSTANT. If 017 already
 * remembers which specialty this visitor reads for (`SpecialtyChosen`, the LD-2
 * cascade), the platform knows enough to drop them straight into the 019 events
 * feed — the surface that answers «what is on for me». If it does not, the
 * storefront home is the honest landing: it is where the specialty question is
 * asked, so an unknown doctor is offered the choice rather than dropped into a
 * feed filtered by a guess. That is why an UNRESOLVED read (`choice: null`, the
 * api was unreachable) lands exactly like a resolved «nothing chosen»: both
 * mean «we do not know», and the home page is the surface for not knowing.
 *
 * THE ACCOUNT PAGE IS NEVER A LANDING. An owner decision recorded on LD-4, and
 * the reason this module returns a CLOSED UNION of two paths rather than a
 * `string`: `/account` is not merely untested here, it is unrepresentable. A
 * future handler that wants a third destination has to widen the union, which
 * is a diff a reviewer sees.
 *
 * NO SECOND RETURN VOCABULARY (LD-3). This module never parses, builds or
 * inspects a `returnTo` value. When a return context IS resolved, the landing
 * the route publishes is that context's own safe target — the shared
 * `parseReturnTarget` guard's reconstruction, produced by `lib/return-context.ts`
 * — and this resolver is not consulted at all. One attribute, one vocabulary.
 *
 * CONSUMED SEAM, NOT DECORATION. The route publishes the resolved landing as a
 * server fact on the form (`data-registration-landing`), which is what the
 * browser tier asserts. Its product consumer is the post-confirmation success
 * state of EARS-10 (#1546) — `SuccessState.primaryAction` reads this value
 * rather than recomputing the decision behind the confirmation hop, so the
 * landing a doctor is promised on the door is the landing they get. The hop
 * itself (and the confirmation-time re-validation of a carried return target)
 * is #1546/#1549 and is deliberately not built here: the submit on this screen
 * is inert pending EARS-5 (#1541) and EARS-19 (#1558).
 */

/**
 * The two LD-4 destinations, by name. Values are the doctor storefront's own
 * routes — `app/(storefront)/events/page.tsx` (019's feed) and
 * `app/(storefront)/page.tsx` (the home) — and both resolve on this app, which
 * the browser tier asserts so neither can rot into a dead path.
 */
export const DIRECT_ARRIVAL_LANDING = {
  /** 019's events feed — the doctor already told us what they read for. */
  eventsFeed: "/events",
  /** The storefront home — where the specialty question is asked. */
  home: "/",
} as const;

/** Exactly the two LD-4 destinations; `/account` is unrepresentable. */
export type DirectArrivalLanding =
  (typeof DIRECT_ARRIVAL_LANDING)[keyof typeof DIRECT_ARRIVAL_LANDING];

/**
 * LD-4, as a pure function of what 017 remembers about this visitor.
 *
 * Takes the already-resolved `RememberedSpecialty` rather than reading it
 * itself: the read is the route's (one `headers()` read per render), and a
 * decision with no I/O in it is a decision a unit test can pin.
 */
export function resolveDirectArrivalLanding(
  remembered: RememberedSpecialty,
): DirectArrivalLanding {
  // `choice: null` is «unresolved», `choice.specialty: null` is «resolved:
  // nothing chosen». Different facts, same landing — see the header.
  return remembered.choice?.specialty
    ? DIRECT_ARRIVAL_LANDING.eventsFeed
    : DIRECT_ARRIVAL_LANDING.home;
}
