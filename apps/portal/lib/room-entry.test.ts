import { describe, expect, it } from "vitest";

import { resolveRoomEntryHref } from "./registration-state";

/**
 * 006 EARS-6 — the registered-live room front door on the event page. The room
 * surface (`/webinars/:slug/room`) shipped in EARS-1..7, so the entry CTA that was
 * deliberately deferred to #584 (a `/room` link would have 404'd before the room
 * existed — the #673 Stage-B finding) is now restored: a doctor who is registered
 * AND on a `live` event gets a real link into the room, resolving to the canonical
 * `/webinars/<slug>/room` path. Every other branch — registered on a non-live
 * event, an unregistered doctor, or a guest — renders NO room link (the register
 * front door / lifecycle affordance stands). This pins the pure state→href
 * decision that drives that single CTA, mirroring `resolveJoinSignpost`.
 */
describe("006 EARS-6 resolveRoomEntryHref — registered-live room front-door decision", () => {
  it("EARS-6.1: when the doctor is registered on a live event, the system shall link to the canonical room route", () => {
    expect(
      resolveRoomEntryHref({ registered: true, registeredAt: "x" }, "live", "cardio-2026"),
    ).toBe("/webinars/cardio-2026/room");
  });

  it("EARS-6: when the doctor is registered but the event is upcoming, the system shall render no room link (the confirmation stands)", () => {
    expect(
      resolveRoomEntryHref({ registered: true, registeredAt: "x" }, "upcoming", "cardio-2026"),
    ).toBeNull();
  });

  it("EARS-6: when the doctor is registered but the event is ended/archived, the system shall render no room link", () => {
    expect(
      resolveRoomEntryHref({ registered: true, registeredAt: "x" }, "ended", "cardio-2026"),
    ).toBeNull();
    expect(
      resolveRoomEntryHref({ registered: true, registeredAt: "x" }, "archived", "cardio-2026"),
    ).toBeNull();
  });

  it("EARS-6: when the doctor is unregistered, the system shall render no room link (the register front door stands)", () => {
    expect(resolveRoomEntryHref({ registered: false }, "live", "cardio-2026")).toBeNull();
  });

  it("EARS-6: when there is no authenticated state (a guest), the system shall render no room link", () => {
    expect(resolveRoomEntryHref(null, "live", "cardio-2026")).toBeNull();
  });

  it("EARS-6: the room href is the hardened same-origin room path — a hostile slug can never front a cross-origin target", () => {
    expect(
      resolveRoomEntryHref({ registered: true, registeredAt: "x" }, "live", "a/b"),
    ).toBe("/webinars/a%2Fb/room");
  });
});
