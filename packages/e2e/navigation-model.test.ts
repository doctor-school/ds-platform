import { describe, expect, it } from "vitest";

import {
  itemsFor,
  landingEvidence,
  byId,
  type NavigationModel,
} from "./navigation-model";

/**
 * The navigation model is the contract both storefront headers render FROM and
 * the derived navigation walk reads (staging/regression-contour tech spec §6.3,
 * Issue #2067). These are the PURE seams: audience projection, landing-evidence
 * resolution and id lookup. The browser half is `derived/` (deliverable 4).
 */
const model: NavigationModel = [
  {
    id: "discovery",
    label: "navBroadcasts",
    href: "/webinars",
    landing: { h1: "Расписание эфиров" },
    audience: "both",
  },
  {
    id: "my-events",
    label: "navMyEvents",
    href: "/account/events",
    landing: { h1: "Мои события" },
    audience: "doctor",
  },
  {
    id: "login",
    label: "login",
    href: "/login",
    landing: { surface: "login" },
    audience: "guest",
  },
];

describe("itemsFor", () => {
  it("gives a guest the guest items and the both-audience items, in model order", () => {
    expect(itemsFor(model, "guest").map((i) => i.id)).toEqual([
      "discovery",
      "login",
    ]);
  });

  it("gives a signed-in doctor the doctor items and the both-audience items", () => {
    expect(itemsFor(model, "doctor").map((i) => i.id)).toEqual([
      "discovery",
      "my-events",
    ]);
  });

  it("never returns an item of the other audience (the walk would assert the wrong landing)", () => {
    for (const visitor of ["guest", "doctor"] as const) {
      for (const item of itemsFor(model, visitor)) {
        expect(item.audience === visitor || item.audience === "both").toBe(true);
      }
    }
  });
});

describe("landingEvidence", () => {
  it("reads an h1 landing as an h1 assertion", () => {
    expect(landingEvidence(model[0]!)).toEqual({
      kind: "h1",
      value: "Расписание эфиров",
    });
  });

  it("reads a surface landing as a data-surface assertion", () => {
    expect(landingEvidence(model[2]!)).toEqual({ kind: "surface", value: "login" });
  });
});

describe("byId", () => {
  it("indexes the model by its stable route id", () => {
    expect(byId(model).discovery!.href).toBe("/webinars");
  });

  it("throws on a duplicate id rather than silently dropping an item", () => {
    expect(() => byId([...model, model[0]!])).toThrow(/discovery/);
  });
});
