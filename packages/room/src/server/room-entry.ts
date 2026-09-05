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
 * The two tables differ on exactly one branch, and that difference is the reason
 * this is parameterised rather than hardcoded: the Academy sends a guest through
 * its 003 login flow carrying a same-origin room `returnTo`, while the doctor
 * storefront has no login route at all and sends the visitor to its own event
 * page (D10 / ADR-0015 §4 REQ-24 — doctor.school holds exactly one link into the
 * Academy, and a cross-origin `returnTo` would be refused by the Academy's
 * same-origin guard anyway).
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
