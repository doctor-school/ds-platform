// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import type { ReturnTargetParking } from "../return-target";
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
 * What the move CHANGES: the cookie name is no longer a module constant but the
 * host's own `returnTo.parkingCookie` - the same declaration the parking rule
 * writes through - and `undefined` parking (row 29, the doctor storefront) makes
 * every read a no-op instead of reaching for a cookie that host never sets.
 */

const parking: ReturnTargetParking = {
  name: "ds_return_to",
  maxAgeSeconds: 900,
};

function park(rawCookieValue: string): void {
  document.cookie = `${parking.name}=${rawCookieValue}; Path=/`;
}

describe("014 EARS-6 shared return-target store", () => {
  afterEach(() => {
    clearStoredReturnTarget(parking);
  });

  it("014 EARS-6.5: the parked target survives the interruption of the verification mail", () => {
    park(encodeURIComponent("/webinars/ahilles-042"));
    expect(readStoredReturnTarget(parking)).toBe("/webinars/ahilles-042");
    expect(resolveReturnTarget(null, parking)).toBe("/webinars/ahilles-042");
  });

  it("014 EARS-6.6: the target is consumed exactly once and then cleared", () => {
    park(encodeURIComponent("/account/events"));
    expect(resolveReturnTarget(null, parking)).toBe("/account/events");
    expect(readStoredReturnTarget(parking)).toBeNull();
    expect(resolveReturnTarget(null, parking)).toBeNull();
  });

  it("014 EARS-6.7: a still-present query target wins over the parked one, and clears it", () => {
    park(encodeURIComponent("/webinars/stale-042"));
    expect(resolveReturnTarget("/webinars/fresh-042", parking)).toBe(
      "/webinars/fresh-042",
    );
    expect(readStoredReturnTarget(parking)).toBeNull();
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
      expect(readStoredReturnTarget(parking), `must reject: ${evil}`).toBeNull();
      park(evil);
      expect(resolveReturnTarget(null, parking)).toBeNull();
    }
  });

  it("014 EARS-6.8: a hostile query target is dropped even with no parked target", () => {
    expect(resolveReturnTarget("https://example.invalid/", parking)).toBeNull();
    expect(resolveReturnTarget("//example.invalid/", parking)).toBeNull();
    expect(resolveReturnTarget(null, parking)).toBeNull();
  });

  it("014 EARS-6.9: a host that parks nothing reads nothing - only the carried query target", () => {
    park(encodeURIComponent("/webinars/ahilles-042"));
    expect(readStoredReturnTarget(undefined)).toBeNull();
    expect(resolveReturnTarget(null, undefined)).toBeNull();
    expect(resolveReturnTarget("/events/ahilles-042", undefined)).toBe(
      "/events/ahilles-042",
    );
    // The other host's cookie is left untouched, never cleared by a host that
    // does not own it.
    expect(readStoredReturnTarget(parking)).toBe("/webinars/ahilles-042");
  });
});
