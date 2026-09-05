import { describe, expect, it } from "vitest";

import { NO_SPECIALTY_CHOICE } from "./specialty-choice";
import type { RememberedSpecialty } from "./specialty-choice";
import {
  DIRECT_ARRIVAL_LANDING,
  resolveDirectArrivalLanding,
} from "./registration-landing";

/**
 * 021 EARS-3 (#1539) — LD-4, the direct-arrival landing.
 *
 * A doctor who opened `/register` on their own carries no return target, so
 * there is nothing for the post-confirmation hop to return them TO. LD-4 fixes
 * what stands in its place, and fixes it as a decision about the doctor rather
 * than a constant: the 019 events feed when the platform already remembers
 * which specialty they read for (017 `SpecialtyChosen`), the storefront home
 * otherwise. The account page is NEVER a landing — an owner decision recorded
 * on LD-4, and the reason the return type is a closed union of exactly two
 * destinations: `/account` is not merely untested here, it is unrepresentable.
 *
 * `choice: null` («could not resolve», the api was unreachable) lands the same
 * way as a resolved «nothing chosen»: the home page is the surface that lets a
 * doctor pick a specialty, so an unknown read offers it rather than dropping
 * them into a feed filtered by a choice nobody has confirmed they made.
 */
const CHOSEN = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "kardiologiya",
  name: "Кардиология",
  isOther: false,
} as const;

function remembered(
  choice: RememberedSpecialty["choice"],
  actor: RememberedSpecialty["actor"] = "guest",
): RememberedSpecialty {
  return { actor, choice };
}

describe("021 EARS-3 — the direct-arrival landing (LD-4)", () => {
  it("021 EARS-3: a remembered specialty lands the doctor on the 019 events feed", () => {
    expect(
      resolveDirectArrivalLanding(
        remembered({ specialty: CHOSEN, storedIn: "session" }),
      ),
    ).toBe("/events");
  });

  it("021 EARS-3: a doctor-stored remembered specialty lands on the same feed — the store is not the decision", () => {
    expect(
      resolveDirectArrivalLanding(
        remembered({ specialty: CHOSEN, storedIn: "profile" }, "doctor"),
      ),
    ).toBe(DIRECT_ARRIVAL_LANDING.eventsFeed);
  });

  it("021 EARS-3: a resolved 'nothing chosen yet' lands on the storefront home", () => {
    expect(resolveDirectArrivalLanding(remembered(NO_SPECIALTY_CHOICE))).toBe(
      "/",
    );
  });

  it("021 EARS-3: an unresolved read (api unreachable) lands on the storefront home, not a feed filtered by a guess", () => {
    expect(resolveDirectArrivalLanding(remembered(null))).toBe(
      DIRECT_ARRIVAL_LANDING.home,
    );
    expect(resolveDirectArrivalLanding(remembered(null, "doctor"))).toBe("/");
  });

  it("021 EARS-3: the account page is never a landing — the union carries exactly the two LD-4 destinations", () => {
    const destinations = Object.values(DIRECT_ARRIVAL_LANDING);
    expect(new Set(destinations)).toEqual(new Set(["/events", "/"]));
    expect(destinations).not.toContain("/account");
  });
});
