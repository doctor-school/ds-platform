import type { RoomConfig } from "@ds/schemas";

import type { RoomAccess } from "./room-config";

/**
 * 006 EARS-6 / 020 §6.1 — denied-access routing, as a PURE function.
 *
 * The room gate is server-side and authoritative (EARS-1); this resolver does not
 * re-implement it. It maps the grant's four outcomes onto ONE host's route table
 * so both storefronts route truthfully — never a soft wall over a rendered
 * player, and never a redirect into the OTHER host's flows.
 *
 * The two tables have the same shape and differ only in their paths, which is the
 * reason this is parameterised rather than hardcoded: each host sends a guest to
 * its OWN `/login` carrying a same-origin `returnTo` back to its own room — the
 * Academy's `/webinars/<slug>/room`, the doctor storefront's `/events/<slug>/room`
 * (020 EARS-7). Never the other host's login: a cross-origin `returnTo` would be
 * refused by the same-origin guard anyway (ADR-0015 §4 REQ-24).
 *
 * The outcome set is CLOSED — `render`, `redirect(href)`, `not-found` — so a host
 * page is a `switch` over three cases and cannot silently fall through to
 * rendering a room the gate refused.
 */

/** One host's three redirect targets for the three refusal branches. */
export interface RoomEntryRoutes {
  /** Unauthenticated (401). */
  auth: string;
  /** Authenticated but not on the roster (403). */
  register: string;
  /** Registered, event not live (409). */
  notLive: string;
}

export type RoomEntryOutcome =
  | { kind: "render"; config: RoomConfig }
  | { kind: "redirect"; href: string }
  | { kind: "not-found" };

export function resolveRoomEntry(
  access: RoomAccess,
  routes: RoomEntryRoutes,
): RoomEntryOutcome {
  switch (access.kind) {
    case "granted":
      return { kind: "render", config: access.config };
    case "auth":
      return { kind: "redirect", href: routes.auth };
    case "register":
      return { kind: "redirect", href: routes.register };
    case "not-live":
      return { kind: "redirect", href: routes.notLive };
    case "not-found":
      return { kind: "not-found" };
  }
}
