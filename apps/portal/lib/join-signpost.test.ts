import { describe, expect, it } from "vitest";

import type { PrimaryCta } from "./event-lifecycle";
import { resolveJoinSignpost, showRegisteredConfirmation } from "./registration-state";

/**
 * 005 EARS-5 — for a registered doctor the event page signposts HOW/WHEN they
 * will join: in the `upcoming` state, when the broadcast starts (МСК) and that
 * they are registered; in the `live` state, an obvious onward path to the room
 * (feature 006 target). This pins the pure state→render decision that drives the
 * two registered signpost modes on top of the 004 lifecycle CTA:
 *   • registered + register-CTA (upcoming) → the `upcoming` confirmation signpost;
 *   • registered + room-CTA (live)         → the `live` onward-to-room signpost,
 *     carrying the room route (feature 006) so the page never has to re-derive it;
 *   • registered + no-CTA (ended/archived) → no signpost (004 owns those renders);
 *   • unregistered / guest                 → no signpost (the 004 register CTA).
 *
 * The `live` signpost is the EARS-5 gap over EARS-4 (#568): EARS-4's
 * `showRegisteredConfirmation` deliberately left the `live` room route untouched
 * ("belongs to EARS-5 #569"); this resolver closes it, and re-expresses
 * `showRegisteredConfirmation` as the `upcoming` case so the EARS-4 contract holds.
 */

const REGISTER_CTA: PrimaryCta = {
  kind: "register",
  href: "/register?returnTo=%2Fwebinars%2Fx",
};
const ROOM_CTA: PrimaryCta = { kind: "room", href: "/webinars/x/room" };
const NO_CTA: PrimaryCta = { kind: "none" };

describe("005 EARS-5 resolveJoinSignpost — registered join-signpost render decision", () => {
  it("EARS-5.1: when the doctor is registered on an upcoming event, the system shall signpost the upcoming (when-you-join) confirmation", () => {
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, REGISTER_CTA),
    ).toEqual({ kind: "upcoming" });
  });

  it("EARS-5.2: when the doctor is registered on a live event, the system shall signpost the onward path to the room, carrying the room route (006)", () => {
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, ROOM_CTA),
    ).toEqual({ kind: "live", roomHref: "/webinars/x/room" });
  });

  it("EARS-5: when the doctor is registered on an ended/archived event (no CTA), the system shall render no join signpost (004 owns that render)", () => {
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, NO_CTA),
    ).toEqual({ kind: "none" });
  });

  it("EARS-5: when the doctor is unregistered, the system shall render no join signpost (the 004 register CTA stands)", () => {
    expect(resolveJoinSignpost({ registered: false }, REGISTER_CTA)).toEqual({
      kind: "none",
    });
  });

  it("EARS-5: when there is no authenticated state (a guest), the system shall render no join signpost", () => {
    expect(resolveJoinSignpost(null, REGISTER_CTA)).toEqual({ kind: "none" });
    expect(resolveJoinSignpost(null, ROOM_CTA)).toEqual({ kind: "none" });
  });

  it("EARS-5: the EARS-4 `showRegisteredConfirmation` primitive is exactly the `upcoming` signpost case (never the live room route)", () => {
    // The EARS-4 register-CTA swap must stay identical to the resolver's `upcoming`
    // arm — a registered doctor on a live event keeps the room route, not a static
    // confirmation, so EARS-4's `showRegisteredConfirmation` stays false there.
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, REGISTER_CTA),
    ).toBe(true);
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, ROOM_CTA),
    ).toBe(false);
  });
});
