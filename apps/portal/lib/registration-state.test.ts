import { describe, expect, it } from "vitest";

import type { PrimaryCta } from "./event-lifecycle";
import { showRegisteredConfirmation } from "./registration-state";

/**
 * 005 EARS-4 — the event page reflects the authenticated doctor's TRUE
 * registration state: registered → the confirmation replacing the register CTA;
 * unregistered (or a guest) → the 004 «Участвовать» register CTA. This pins the
 * pure state→render decision — a registered doctor is never shown the register
 * CTA as if unregistered, and the swap only ever replaces a `register` CTA (the
 * `live` room route + `ended`/`archived` no-CTA renders are left untouched — those
 * belong to EARS-5 #569 / 006).
 */

const REGISTER_CTA: PrimaryCta = {
  kind: "register",
  href: "/register?returnTo=%2Fwebinars%2Fx",
};
const ROOM_CTA: PrimaryCta = { kind: "room", href: "/webinars/x/room" };
const NO_CTA: PrimaryCta = { kind: "none" };

describe("005 EARS-4 showRegisteredConfirmation — registered-state render decision", () => {
  it("EARS-4: when the doctor is registered and the page would show the register CTA (upcoming), the system shall show the confirmation instead", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, REGISTER_CTA),
    ).toBe(true);
  });

  it("EARS-4: when the doctor is unregistered, the system shall keep the 004 «Участвовать» register CTA (no confirmation)", () => {
    expect(showRegisteredConfirmation({ registered: false }, REGISTER_CTA)).toBe(
      false,
    );
  });

  it("EARS-4: when there is no authenticated state (a guest), the system shall keep the 004 register CTA", () => {
    expect(showRegisteredConfirmation(null, REGISTER_CTA)).toBe(false);
  });

  it("EARS-4: the confirmation swap replaces ONLY a register CTA — a registered doctor on a live event keeps the room route (EARS-5 #569 / 006), not this handler", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, ROOM_CTA),
    ).toBe(false);
  });

  it("EARS-4: a registered doctor on an ended/archived event (no register CTA) triggers no confirmation swap", () => {
    expect(
      showRegisteredConfirmation({ registered: true, registeredAt: "x" }, NO_CTA),
    ).toBe(false);
  });
});
