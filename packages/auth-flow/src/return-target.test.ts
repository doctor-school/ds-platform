import { describe, expect, it } from "vitest";

import { parseAccountReturnTarget, parseCoursesReturnTarget } from "./return-target";

/**
 * 014 EARS-6 / #1987 — the ACCOUNT FAMILY is the non-эфир landing shape.
 *
 * Wave-1 gate row 32 admitted exactly `routes.account`, which made every page
 * BELOW the cabinet a lost target: a guest bounced off the Academy's
 * `/account/events` («Мои события») landed on the default listing after a
 * successful sign-in — the one place they had just asked not to go (live C6
 * walk, PR #2205).
 *
 * The family is DERIVED from the single value both hosts already declare — the
 * host's own `routes.account` — as a prefix with a SEGMENT BOUNDARY, so no host
 * grows a second route field and no package literal names a path. `/accounts`
 * and `/account-evil` share the characters and not the segment, so they are not
 * the family.
 *
 * What is returned changed with it: the MATCHED path (in the canonical form the
 * same-origin guard reconstructs), not the bare configured route — otherwise
 * `/account/events` round-trips to `/account` and the child page is still lost.
 * The reconstruct-never-echo rule is kept by the guard: the value handed back is
 * the guard's own output, never the visitor's raw string.
 */
describe("014 EARS-6 / #1987: the account family is a legal return target", () => {
  it("014 EARS-6.5: the configured account route itself round-trips", () => {
    expect(parseAccountReturnTarget("/account", "/account")).toBe("/account");
  });

  it("014 EARS-6.5: a child of the account route round-trips AS ITSELF, not as the parent", () => {
    expect(parseAccountReturnTarget("/account/events", "/account")).toBe(
      "/account/events",
    );
    // The platform guard's canonical form drops the query for EVERY shape, so
    // the tab is not carried back — the family test reads the path, not the
    // query, and never admits a value the guard refused to reconstruct.
    expect(
      parseAccountReturnTarget("/account/events?tab=recordings", "/account"),
    ).toBe("/account/events");
  });

  it("014 EARS-6.5: the family is host DATA — a host serving its cabinet elsewhere is admitted by configuration", () => {
    expect(parseAccountReturnTarget("/cabinet/events", "/cabinet")).toBe(
      "/cabinet/events",
    );
    // …and that host's family does NOT extend to another host's route.
    expect(parseAccountReturnTarget("/account/events", "/cabinet")).toBeNull();
  });

  it.each([
    ["a prefix collision without a segment boundary", "/account-evil"],
    ["a plural prefix collision", "/accounts"],
    ["a plural collision with a child", "/accounts/events"],
  ])("014 EARS-6.6: %s is NOT the account family", (_label, value) => {
    expect(parseAccountReturnTarget(value, "/account")).toBeNull();
  });

  it.each([
    ["cross-origin", "https://evil.example/account/events"],
    ["protocol-relative", "//evil.example/account"],
    ["a backslash escape", String.raw`/\evil.example/account`],
    ["a traversal that ends in the family", "/webinars/../account/events"],
    ["not a path at all", "account/events"],
  ])(
    "014 EARS-6.6: %s never reaches a navigation — the same-origin guard still rules",
    (_label, value) => {
      expect(parseAccountReturnTarget(value, "/account")).toBeNull();
    },
  );

  it("014 EARS-6.6: a non-account same-origin page is not the account shape", () => {
    expect(parseAccountReturnTarget("/webinars/ahilles-042", "/account")).toBeNull();
    expect(parseAccountReturnTarget(null, "/account")).toBeNull();
    expect(parseAccountReturnTarget(undefined, "/account")).toBeNull();
  });
});

/**
 * 024 EARS-22 — the LEARNING FAMILY: a guest gated on a course or a step
 * («… Вернём вас сюда.») comes back to it after registration or sign-in. The
 * family is host DATA (`routes.courses`, doctor host only — the Academy answers
 * `/courses/*` 404 by EARS-27, so it declares none and admits none), with the
 * same segment boundary and same-origin guard as the account family.
 */
describe("024 EARS-22: the learning family is a legal return target on the host that declares it", () => {
  it.each([
    ["the course path", "/courses/osnovy-prp"],
    ["a step of the course", "/courses/osnovy-prp/steps/0b6a4c1e-4f6f-4b8e-9d1a-2f0c3e5d7a90"],
  ])("024 EARS-22: %s round-trips as itself", (_label, value) => {
    expect(parseCoursesReturnTarget(value, "/courses")).toBe(value);
  });

  it.each([
    ["a prefix collision without a segment boundary", "/coursesX"],
    ["a plural-hyphen collision", "/courses-evil/x"],
    ["protocol-relative", "//evil.example/courses/x"],
    ["cross-origin", "https://evil.example/courses/x"],
    ["a traversal that ends in the family", "/events/../courses/x"],
    ["not a path at all", "courses/x"],
  ])("024 EARS-22: %s is refused", (_label, value) => {
    expect(parseCoursesReturnTarget(value, "/courses")).toBeNull();
  });

  it("024 EARS-27: a host that declares no learning family admits none", () => {
    expect(parseCoursesReturnTarget("/courses/osnovy-prp", undefined)).toBeNull();
  });
});
