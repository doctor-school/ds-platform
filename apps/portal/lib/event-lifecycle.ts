import type { PublicEventState } from "@ds/schemas";

import { buildRegistrationHref } from "./registration-handoff";

/**
 * 004 EARS-4 — the event-page lifecycle render swap. The public event page
 * reflects the event's current state from the single `EventLifecycleState`,
 * swapping the hero badge, the time plate, the CTA affordance, and the footer
 * band per the canvas `status` enum (`upcoming | live | ended`), and never
 * showing a signal that contradicts the machine.
 *
 * This module is the pure state→render mapping (the copy + geometry live in the
 * page + the `WebinarStatusCard` DS primitive). It maps the publish-safe
 * projection `state` (`published | live | ended | archived`) onto the canvas
 * `status` enum, and resolves the SINGLE primary participation CTA target:
 *
 *   • `published` (upcoming) → registration flow (feature 005) via auth (003),
 *     carrying the event context (EARS-3, `buildRegistrationHref`).
 *   • `live`                 → the webinar room (feature 006). 004 asserts the
 *     routing TARGET only; the room + its server-side join gating are 006 (a
 *     tracked seam, design §8). 004 never renders the room.
 *   • `ended` / `archived`   → NO CTA. The `ended` render carries no dead link
 *     (EARS-4 invariant); `archived` is the EARS-5 notice (sibling handler), and
 *     it too carries no participation CTA.
 */

/** The canvas `status` render enum (`webinar-page.dc.html`). */
export type CanvasStatus = "upcoming" | "live" | "ended" | "archived";

/**
 * Map the publish-safe projection `state` onto the canvas `status` render enum.
 * `published` is the canvas's `upcoming`; `live`/`ended`/`archived` map through
 * unchanged. This is the single source the page's per-state render reads, so the
 * rendered signal can never contradict the `EventLifecycleState` (EARS-4).
 */
export function toCanvasStatus(state: PublicEventState): CanvasStatus {
  return state === "published" ? "upcoming" : state;
}

/**
 * Build the same-origin webinar-room href the `live`-state CTA routes toward
 * (feature 006 seam). 004 owns the ROUTE, not the room: the slug is
 * `encodeURIComponent`-escaped so a hostile slug can never break out of the
 * same-origin `/webinars/` path, mirroring `buildRegistrationHref`. The room and
 * its join gating are built by 006; until then this target is a tracked seam
 * (design §8) — 004's E2E asserts the CTA points here, not that the room loads.
 */
export function buildRoomHref(slug: string): string {
  return `/webinars/${encodeURIComponent(slug)}/room`;
}

/** The single primary participation CTA the page renders for a lifecycle state. */
export type PrimaryCta =
  | { kind: "register"; href: string }
  | { kind: "room"; href: string }
  | { kind: "none" };

/**
 * Resolve the SINGLE primary «Участвовать» participation CTA for an event in
 * `state` (EARS-3/EARS-4). Exactly one primary CTA on the page; the `ended` and
 * `archived` renders carry NONE (never a dead link — requirements Invariants).
 */
export function resolvePrimaryCta(
  state: PublicEventState,
  slug: string,
): PrimaryCta {
  switch (state) {
    case "published":
      return { kind: "register", href: buildRegistrationHref(slug) };
    case "live":
      return { kind: "room", href: buildRoomHref(slug) };
    case "ended":
    case "archived":
    default:
      return { kind: "none" };
  }
}
