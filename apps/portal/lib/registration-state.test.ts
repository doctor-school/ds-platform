import { describe, expect, it } from "vitest";

import { showRegisteredConfirmation } from "./registration-state";

/**
 * 005 EARS-4 — the event page reflects the authenticated doctor's TRUE
 * registration state: registered → the confirmation replacing the register CTA;
 * unregistered (or a guest) → the 004 «Участвовать» register CTA. This pins the
 * pure state→render decision — a registered doctor is never shown the register
 * CTA as if unregistered, and the confirmation swap fires only for the
 * `upcoming` lifecycle status (the registered-`live` render is EARS-5's live
 * signpost; `ended`/`archived` carry no register CTA at all).
 */

describe("005 EARS-4 showRegisteredConfirmation — registered-state render decision", () => {
  it("EARS-4: when the doctor is registered and the page would show the register CTA (upcoming), the system shall show the confirmation instead", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, "upcoming"),
    ).toBe(true);
  });

  it("EARS-4: when the doctor is unregistered, the system shall keep the 004 «Участвовать» register CTA (no confirmation)", () => {
    expect(showRegisteredConfirmation({ registered: false }, "upcoming")).toBe(
      false,
    );
  });

  it("EARS-4: when there is no authenticated state (a guest), the system shall keep the 004 register CTA", () => {
    expect(showRegisteredConfirmation(null, "upcoming")).toBe(false);
  });

  it("EARS-4: a registered doctor on a live event gets the EARS-5 live signpost, not this upcoming confirmation swap", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, "live"),
    ).toBe(false);
  });

  it("EARS-4: a registered doctor on an ended/archived event (no register CTA) triggers no confirmation swap", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, "ended"),
    ).toBe(false);
    expect(
      showRegisteredConfirmation(
        { registered: true, registeredAt: "x" },
        "archived",
      ),
    ).toBe(false);
  });
});
