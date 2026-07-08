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
 *   • `live`                 → registration TOO (005 EARS-1/EARS-9:
 *     register-during-live is a normal path — a NOT-yet-registered viewer must
 *     register first, one-tap when authenticated, through auth when a guest).
 *     The onward-to-room affordance for a REGISTERED doctor is the 006 room
 *     surface (#584) — until it ships, no 005 render links to `/room` (a dead
 *     link / 404 is a banned pattern; the deferral is tracked on #584).
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

/** The single primary participation CTA the page renders for a lifecycle state. */
export type PrimaryCta =
  | { kind: "register"; href: string }
  | { kind: "none" };

/**
 * Resolve the SINGLE primary «Участвовать» participation CTA for an event in
 * `state` (EARS-3/EARS-4). Exactly one primary CTA on the page; the `ended` and
 * `archived` renders carry NONE (never a dead link — requirements Invariants).
 *
 * Both registrable states (`published` and `live` — 005 EARS-9) resolve to the
 * REGISTRATION target: the page renders it as the one-tap command for an
 * authenticated doctor (005 EARS-1) and as the `/register?returnTo=…` auth
 * handoff for a guest (005 EARS-2). A registered doctor never sees this CTA at
 * all (005 EARS-4 — the join signpost replaces it, `lib/registration-state`).
 */
export function resolvePrimaryCta(
  state: PublicEventState,
  slug: string,
): PrimaryCta {
  switch (state) {
    case "published":
    case "live":
      return { kind: "register", href: buildRegistrationHref(slug) };
    case "ended":
    case "archived":
    default:
      return { kind: "none" };
  }
}
