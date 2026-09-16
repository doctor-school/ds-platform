import { describe, expect, it } from "vitest";

import { doctorNav, doctorNavigationModel } from "@/lib/navigation-model";
import { DOCTOR_SHELL } from "@/lib/shell-config";
import { shellAuthState } from "@/lib/shell-auth";

/**
 * The §6.3 invariant of the staging/regression-contour tech spec (Issue #2067),
 * stated as a test rather than as a comment: the links this storefront's chrome
 * PAINTS and the links the derived navigation walk VISITS are one list.
 *
 * Both directions matter and both are asserted below. A destination the chrome
 * paints but the model omits is a link no walk would ever open; a destination the
 * model carries but the chrome paints nowhere is a walk asserting an affordance
 * the visitor cannot reach. The first is the blindness #2067 exists to remove,
 * the second is how a stale model quietly turns green.
 */
const guest = shellAuthState({ status: "guest" });
const signedIn = shellAuthState({ status: "doctor" });

if (guest.status !== "guest" || signedIn.status !== "doctor") {
  throw new Error(
    "shellAuthState no longer returns the two branches asserted here.",
  );
}

/** Every destination the shared chrome (`@ds/storefront-shell`) links to for
 *  this host: the wordmark, the nav, the search target and both auth branches. */
const paintedHrefs: readonly string[] = [
  DOCTOR_SHELL.logo.href,
  ...DOCTOR_SHELL.nav.map((item) => item.href),
  ...(DOCTOR_SHELL.search ? [DOCTOR_SHELL.search.action] : []),
  guest.loginHref,
  signedIn.profileHref,
];

describe("§6.3: the doctor chrome and the navigation model are one list", () => {
  it("paints no destination the navigation model does not carry", () => {
    const modelHrefs = doctorNavigationModel.map((item) => item.href);

    for (const href of paintedHrefs) {
      expect(modelHrefs, `chrome href ${href}`).toContain(href);
    }
  });

  it("carries no model destination the chrome paints nowhere", () => {
    for (const item of doctorNavigationModel) {
      expect(paintedHrefs, `model item ${item.id}`).toContain(item.href);
    }
  });

  it("renders the model's own copy, so moving a label changes no byte", () => {
    expect(DOCTOR_SHELL.logo.alt).toBe(doctorNav.home.label);
    expect(DOCTOR_SHELL.nav.map((item) => item.label)).toEqual([
      doctorNav.events.label,
    ]);
    expect(guest.label).toBe(doctorNav.login.label);
    expect(signedIn.label).toBe(doctorNav.account.label);
  });

  it("keeps the header search pointed at the listing the nav already names", () => {
    expect(DOCTOR_SHELL.search?.action).toBe(doctorNav.events.href);
  });
});
