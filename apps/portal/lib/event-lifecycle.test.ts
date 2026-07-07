import { describe, expect, it } from "vitest";

import {
  buildRoomHref,
  resolvePrimaryCta,
  toCanvasStatus,
} from "./event-lifecycle";

/**
 * 004 EARS-4 — the event-page lifecycle render swap: the page reflects the event
 * state from the single `EventLifecycleState`, never contradicting the machine.
 * This pins the pure state→render mapping — the canvas `status` enum mapping and
 * the single primary-CTA target resolution (upcoming → registration, live → the
 * room seam 006, ended/archived → no CTA / no dead link).
 */

const SLUG = "ahilles-plastika";

describe("toCanvasStatus — projection state → canvas status enum (EARS-4)", () => {
  it("EARS-4: when the event is published, the system shall render the upcoming status", () => {
    expect(toCanvasStatus("published")).toBe("upcoming");
  });

  it("EARS-4: when the event is live, the system shall render the live status", () => {
    expect(toCanvasStatus("live")).toBe("live");
  });

  it("EARS-4: when the event has ended, the system shall render the ended status", () => {
    expect(toCanvasStatus("ended")).toBe("ended");
  });

  it("EARS-4: when the event is archived, the mapping shall not contradict the machine (archived stays archived, never live/upcoming)", () => {
    expect(toCanvasStatus("archived")).toBe("archived");
  });
});

describe("resolvePrimaryCta — the single participation CTA target (EARS-4)", () => {
  it("EARS-4: when the event is upcoming (published), the CTA shall route into the registration flow carrying the event context", () => {
    const cta = resolvePrimaryCta("published", SLUG);
    expect(cta.kind).toBe("register");
    expect(cta).toMatchObject({
      href: `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG}`)}`,
    });
  });

  it("EARS-4: when the event is live, the CTA shall route toward the room (feature 006)", () => {
    const cta = resolvePrimaryCta("live", SLUG);
    expect(cta.kind).toBe("room");
    expect(cta).toMatchObject({ href: `/webinars/${SLUG}/room` });
  });

  it("EARS-4: when the event has ended, the system shall render no participation CTA (no dead link)", () => {
    expect(resolvePrimaryCta("ended", SLUG)).toEqual({ kind: "none" });
  });

  it("EARS-4: when the event is archived, the system shall render no participation CTA", () => {
    expect(resolvePrimaryCta("archived", SLUG)).toEqual({ kind: "none" });
  });
});

describe("buildRoomHref — the room seam route (EARS-4, feature 006)", () => {
  it("EARS-4: the room href is a same-origin /webinars/:slug/room path", () => {
    expect(buildRoomHref(SLUG)).toBe(`/webinars/${SLUG}/room`);
  });

  it("EARS-4: a hostile slug cannot break out of the same-origin /webinars/ path", () => {
    expect(buildRoomHref("//evil.example")).toBe(
      `/webinars/${encodeURIComponent("//evil.example")}/room`,
    );
  });
});
