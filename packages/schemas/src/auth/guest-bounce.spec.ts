import { describe, expect, it } from "vitest";

import {
  GUEST_BOUNCE_ATTRIBUTE,
  declaredGuestBounce,
  guestBounceMarker,
} from "./guest-bounce.js";

/**
 * 003 EARS-73 — the bounce a route core declares is followed by the shell with
 * `location.assign`, so the read accepts a same-origin absolute path only and
 * answers `null` (→ the in-place `router.refresh()`) for anything else.
 */
const ORIGIN = "https://academy.doctor.school";
const BASE = {
  origin: ORIGIN,
  originOf: (href: string) => new URL(href, ORIGIN).origin,
};

function rootWith(value: string | null) {
  return {
    querySelector: (selectors: string) =>
      value === null || selectors !== `[${GUEST_BOUNCE_ATTRIBUTE}]`
        ? null
        : {
            getAttribute: (name: string) =>
              name === GUEST_BOUNCE_ATTRIBUTE ? value : null,
          },
  };
}

describe("003 EARS-73: declaredGuestBounce", () => {
  it("003 EARS-73: the marker carries the core's bounce, hidden", () => {
    expect(guestBounceMarker("/login?returnTo=%2Faccount")).toEqual({
      "data-guest-bounce": "/login?returnTo=%2Faccount",
      hidden: true,
    });
  });

  it.each([
    "/login?returnTo=%2Faccount",
    "/login?returnTo=%2Faccount%2Fevents",
    "/login?returnTo=%2Fwebinars%2Fcardio-live%2Froom",
  ])(
    "003 EARS-73: a same-origin bounce %s is returned as declared",
    (bounce) => {
      expect(declaredGuestBounce(rootWith(bounce), BASE)).toBe(bounce);
    },
  );

  it("003 EARS-73: a route without a marker declares no bounce", () => {
    expect(declaredGuestBounce(rootWith(null), BASE)).toBeNull();
  });

  it.each([
    ["an absolute URL", "https://evil.example/login"],
    ["an absolute URL of the same origin", `${ORIGIN}/login`],
    ["a protocol-relative URL", "//evil.example/login"],
    ["a backslash protocol-relative URL", "/\\evil.example/login"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a scheme smuggled into the path", "/javascript:alert(1)"],
    ["a tab that the URL parser strips into //", "/\t/evil.example"],
    ["an empty value", ""],
    ["a relative path without a leading slash", "login"],
  ])(
    "003 EARS-73: %s is rejected (null → router.refresh())",
    (_name, value) => {
      expect(declaredGuestBounce(rootWith(value), BASE)).toBeNull();
    },
  );
});

describe("003 EARS-73: the same-origin resolution is the last word", () => {
  it("003 EARS-73: a path whose resolution leaves the origin is rejected", () => {
    const foreign = { origin: ORIGIN, originOf: () => "https://evil.example" };
    expect(declaredGuestBounce(rootWith("/login"), foreign)).toBeNull();
  });

  it("003 EARS-73: a resolution that throws is rejected", () => {
    const broken = {
      origin: ORIGIN,
      originOf: () => {
        throw new TypeError("Invalid URL");
      },
    };
    expect(declaredGuestBounce(rootWith("/login"), broken)).toBeNull();
  });
});
