import { describe, expect, it } from "vitest";

import { resolveJoinSignpost, showRegisteredConfirmation } from "./registration-state";

/**
 * 005 EARS-5 — for a registered doctor the event page signposts HOW/WHEN they
 * will join: in the `upcoming` state, when the broadcast starts (МСК) and that
 * they are registered; in the `live` state, that the broadcast is on and they
 * are on the participant list. This pins the pure state→render decision that
 * drives the two registered signpost modes on top of the 004 lifecycle status:
 *   • registered + `upcoming` → the `upcoming` confirmation signpost;
 *   • registered + `live`     → the `live` "broadcast is on" signpost. The
 *     interactive onward-to-room affordance is the 006 room surface (#584) — the
 *     signpost carries NO room route until the room exists (a `/room` link would
 *     404, the #673 Stage-B rework finding);
 *   • registered + ended/archived → no signpost (004 owns those renders);
 *   • unregistered / guest        → no signpost (the 004 register CTA).
 */

describe("005 EARS-5 resolveJoinSignpost — registered join-signpost render decision", () => {
  it("EARS-5.1: when the doctor is registered on an upcoming event, the system shall signpost the upcoming (when-you-join) confirmation", () => {
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, "upcoming"),
    ).toEqual({ kind: "upcoming" });
  });

  it("EARS-5.2: when the doctor is registered on a live event, the system shall signpost that the broadcast is on — carrying NO room route until the 006 room ships (#584)", () => {
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, "live"),
    ).toEqual({ kind: "live" });
  });

  it("EARS-5: when the doctor is registered on an ended/archived event, the system shall render no join signpost (004 owns that render)", () => {
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, "ended"),
    ).toEqual({ kind: "none" });
    expect(
      resolveJoinSignpost({ registered: true, registeredAt: "x" }, "archived"),
    ).toEqual({ kind: "none" });
  });

  it("EARS-5: when the doctor is unregistered, the system shall render no join signpost (the 004 register CTA stands)", () => {
    expect(resolveJoinSignpost({ registered: false }, "upcoming")).toEqual({
      kind: "none",
    });
  });

  it("EARS-5: when there is no authenticated state (a guest), the system shall render no join signpost", () => {
    expect(resolveJoinSignpost(null, "upcoming")).toEqual({ kind: "none" });
    expect(resolveJoinSignpost(null, "live")).toEqual({ kind: "none" });
  });

  it("EARS-5: the EARS-4 `showRegisteredConfirmation` primitive is exactly the `upcoming` signpost case (the `live` render is the EARS-5 live signpost, not this swap)", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, "upcoming"),
    ).toBe(true);
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, "live"),
    ).toBe(false);
  });
});
