import { describe, expect, it } from "vitest";

import { resolvePrimaryCta, toCanvasStatus } from "./event-lifecycle";

/**
 * 004 EARS-4 — the event-page lifecycle render swap: the page reflects the event
 * state from the single `EventLifecycleState`, never contradicting the machine.
 * This pins the pure state→render mapping — the canvas `status` enum mapping and
 * the single primary-CTA target resolution (upcoming AND live → registration
 * (005 EARS-1/EARS-9: register-during-live is a normal path; the room and its
 * navigation are 006/#584 — no render links to `/room` until it ships),
 * ended/archived → no CTA / no dead link).
 */

const SLUG = "ahilles-plastika";
const REGISTER_HREF = `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG}`)}`;

describe("004 EARS-4 toCanvasStatus — projection state → canvas status enum", () => {
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

describe("004 EARS-4 resolvePrimaryCta — the single participation CTA target", () => {
  it("EARS-4: when the event is upcoming (published), the CTA shall route into the registration flow carrying the event context", () => {
    const cta = resolvePrimaryCta("published", SLUG);
    expect(cta.kind).toBe("register");
    expect(cta).toMatchObject({ href: REGISTER_HREF });
  });

  it("EARS-4: when the event is live, the CTA shall route into the registration flow too (005 EARS-9 register-during-live) — never toward the not-yet-built room (a 404)", () => {
    const cta = resolvePrimaryCta("live", SLUG);
    expect(cta.kind).toBe("register");
    expect(cta).toMatchObject({ href: REGISTER_HREF });
  });

  it("EARS-4: when the event has ended, the system shall render no participation CTA (no dead link)", () => {
    expect(resolvePrimaryCta("ended", SLUG)).toEqual({ kind: "none" });
  });

  it("EARS-4: when the event is archived, the system shall render no participation CTA", () => {
    expect(resolvePrimaryCta("archived", SLUG)).toEqual({ kind: "none" });
  });
});
