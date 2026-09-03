import type { PublicEventState } from "@ds/schemas";

/**
 * 004 EARS-4 — the event-page lifecycle render swap. The public event page
 * reflects the event's current state from the single `EventLifecycleState`,
 * swapping the hero badge and the time plate per the canvas `status` enum
 * (`upcoming | live | ended`), and never showing a signal that contradicts the
 * machine.
 *
 * This module is the pure state→render mapping (the copy + geometry live in the
 * page + the `@ds/design-system` event-page blocks). It maps the publish-safe
 * projection `state` (`published | live | ended | hidden`) onto the canvas
 * `status` enum.
 *
 * The SINGLE primary participation CTA is NOT resolved here: since 020 EARS-1
 * (slice 3, #1764) it is server-resolved by
 * `apps/api/src/events/participation-cta.resolver.ts` and read by the page as a
 * `ParticipationCta` (`apps/portal/lib/participation-cta.ts`), so the label, the
 * href and the "no CTA on `ended`/`hidden`" invariant have exactly one owner.
 */

/** The canvas `status` render enum (`webinar-page.dc.html`). */
export type CanvasStatus = "upcoming" | "live" | "ended" | "hidden";

/**
 * Map the publish-safe projection `state` onto the canvas `status` render enum.
 * `published` is the canvas's `upcoming`; `live`/`ended`/`hidden` map through
 * unchanged. This is the single source the page's per-state render reads, so the
 * rendered signal can never contradict the `EventLifecycleState` (EARS-4).
 *
 * `in_archive` — the 014 terminal state of a pre-platform (legacy) эфир — renders
 * exactly as `ended` does: a broadcast that is over, whose published recording is
 * the only remaining affordance. The canvas has no separate archive artboard
 * because there is no separate render; the distinction is an ADMIN lifecycle fact
 * (014-design §3.1), not a public one.
 */
export function toCanvasStatus(state: PublicEventState): CanvasStatus {
  if (state === "published") return "upcoming";
  if (state === "in_archive") return "ended";
  return state;
}
