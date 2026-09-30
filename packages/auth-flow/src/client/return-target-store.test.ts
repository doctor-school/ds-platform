// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { RETURN_TARGET_PARKING } from "../host-config";
import {
  clearStoredReturnTarget,
  readStoredReturnTarget,
  resolveReturnTarget,
} from "./return-target-store";

/**
 * 014 EARS-6 - the CONSUMPTION half of the platform-wide return-to-origin
 * mechanism (014 design S6), moved out of `apps/portal/lib/return-to-origin.ts`
 * into the shared auth flow (#2027 PR 1.4, rows 29-31).
 *
 * The `@ds/schemas` guard's accept/reject contract is pinned server-side
 * (`apps/api/test/auth/return-target.e2e-spec.ts`); what is pinned HERE is the
 * behaviour the design's two remaining rules describe: the target survives the
 * interruption of the verification mail, and it is consumed EXACTLY ONCE and
 * then cleared, so a later unrelated sign-in cannot teleport the visitor into a
 * stale page.
 *
 * The cookie name is the package `RETURN_TARGET_PARKING` declaration - the same
 * one the parking rule writes through, on both storefronts (row 29, #2443).
 */

const parking = RETURN_TARGET_PARKING;

function park(rawCookieValue: string): void {
  document.cookie = `${parking.name}=${rawCookieValue}; Path=/`;
}

describe("014 EARS-6 shared return-target store", () => {
  afterEach(() => {
    clearStoredReturnTarget();
  });

  it("014 EARS-6.5: the parked target survives the interruption of the verification mail", () => {
    park(encodeURIComponent("/webinars/ahilles-042"));
    expect(readStoredReturnTarget()).toBe("/webinars/ahilles-042");
    expect(resolveReturnTarget(null)).toBe("/webinars/ahilles-042");
  });

  it("014 EARS-6.6: the target is consumed exactly once and then cleared", () => {
    park(encodeURIComponent("/account/events"));
    expect(resolveReturnTarget(null)).toBe("/account/events");
    expect(readStoredReturnTarget()).toBeNull();
    expect(resolveReturnTarget(null)).toBeNull();
  });

  it("014 EARS-6.7: a still-present query target wins over the parked one, and clears it", () => {
    park(encodeURIComponent("/webinars/stale-042"));
    expect(resolveReturnTarget("/webinars/fresh-042")).toBe(
      "/webinars/fresh-042",
    );
    expect(readStoredReturnTarget()).toBeNull();
  });

  it("014 EARS-6.8: a tampered parked target is dropped rather than followed", () => {
    for (const evil of [
      "https%3A%2F%2Fexample.invalid%2F",
      encodeURIComponent("//example.invalid/"),
      encodeURIComponent("/\\example.invalid"),
      encodeURIComponent("/../etc/passwd"),
      "%E0%A4%A",
    ]) {
      park(evil);
      expect(readStoredReturnTarget(), `must reject: ${evil}`).toBeNull();
      park(evil);
      expect(resolveReturnTarget(null)).toBeNull();
    }
  });

  it("014 EARS-6.8: a hostile query target is dropped even with no parked target", () => {
    expect(resolveReturnTarget("https://example.invalid/")).toBeNull();
    expect(resolveReturnTarget("//example.invalid/")).toBeNull();
    expect(resolveReturnTarget(null)).toBeNull();
  });

  it("014 EARS-6.9 (#2443): the store reads the ONE package cookie — the name the parking rule writes on both storefronts", () => {
    expect(parking.name).toBe("ds_return_to");
    document.cookie = `ds_other_park=${encodeURIComponent("/webinars/x-042")}; Path=/`;
    expect(readStoredReturnTarget()).toBeNull();
    document.cookie = "ds_other_park=; Path=/; Max-Age=0";
  });
});
