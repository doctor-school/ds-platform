import { afterEach, describe, expect, it } from "vitest";

import {
  RETURN_TARGET_COOKIE,
  clearStoredReturnTarget,
  readStoredReturnTarget,
  resolveReturnTarget,
} from "./return-to-origin";

// 014 EARS-6 — the portal consumption half of the platform-wide return-to-origin
// mechanism (014 design §6). The `@ds/schemas` guard's accept/reject contract is
// pinned server-side (`apps/api/test/auth/return-target.e2e-spec.ts`); what is
// pinned HERE is the behaviour the design's two remaining rules describe: the
// target survives the interruption of the verification mail (it is parked in a
// short-lived same-origin cookie, so a cold `/verify` open with no query still
// knows where to land), and it is consumed EXACTLY ONCE and then cleared, so a
// later unrelated sign-in cannot teleport the visitor into a stale page.
//
// The describe title OPENS with `014 EARS-6 ` — the ears-test-lint feature scope
// prefix.
function park(rawCookieValue: string): void {
  document.cookie = `${RETURN_TARGET_COOKIE}=${rawCookieValue}; Path=/`;
}

describe("014 EARS-6 portal return-to-origin consumption", () => {
  afterEach(() => {
    clearStoredReturnTarget();
  });

  it("EARS-6: the parked target survives the interruption of the verification mail", () => {
    // The cold `/verify#email=…` open carries NO query at all — the registration
    // branch left the browser and came back. The target parked when the visitor
    // entered the auth flow is what lands them back on their origin page.
    park(encodeURIComponent("/webinars/ahilles-042"));
    expect(readStoredReturnTarget()).toBe("/webinars/ahilles-042");
    expect(resolveReturnTarget(null)).toBe("/webinars/ahilles-042");
  });

  it("EARS-6: the target is consumed exactly once and then cleared", () => {
    park(encodeURIComponent("/account/events"));
    expect(resolveReturnTarget(null)).toBe("/account/events");
    // A second, unrelated sign-in must not be teleported into the old page.
    expect(readStoredReturnTarget()).toBeNull();
    expect(resolveReturnTarget(null)).toBeNull();
  });

  it("EARS-6: a still-present query target wins over the parked one, and clears it", () => {
    park(encodeURIComponent("/webinars/stale-042"));
    expect(resolveReturnTarget("/webinars/fresh-042")).toBe(
      "/webinars/fresh-042",
    );
    expect(readStoredReturnTarget()).toBeNull();
  });

  it("EARS-6: a tampered parked target is dropped rather than followed", () => {
    // A hand-edited cookie is exactly as trusted as a hand-edited query string —
    // both are re-validated at the moment of use, so neither can open-redirect.
    for (const evil of [
      "https%3A%2F%2Fexample.invalid%2F",
      encodeURIComponent("//example.invalid/"),
      encodeURIComponent("/\\example.invalid"),
      encodeURIComponent("/../etc/passwd"),
      "%E0%A4%A", // malformed escape
    ]) {
      park(evil);
      expect(readStoredReturnTarget(), `must reject: ${evil}`).toBeNull();
      park(evil);
      expect(resolveReturnTarget(null)).toBeNull();
    }
  });

  it("EARS-6: a hostile query target is dropped even with no parked target", () => {
    expect(resolveReturnTarget("https://example.invalid/")).toBeNull();
    expect(resolveReturnTarget("//example.invalid/")).toBeNull();
    expect(resolveReturnTarget(null)).toBeNull();
  });
});
