import { describe, expect, it } from "vitest";

import { withReturnTarget } from "./return-target-href";

/**
 * Rule S3 (#2027) / #2331 — the arrival context rides onward on a door's
 * cross-links, and what rides is the same-origin guard's RECONSTRUCTION rather
 * than the visitor's raw string.
 */
describe("withReturnTarget", () => {
  it("021 EARS-10: carries a valid same-origin target on a link that has no query yet", () => {
    expect(withReturnTarget("/login", "/webinars/cardio")).toBe(
      "/login?returnTo=%2Fwebinars%2Fcardio",
    );
  });

  it("021 EARS-10: appends the target to a link that already carries a query", () => {
    expect(withReturnTarget("/verify?email=doc%40clinic.ru", "/events/kardio")).toBe(
      "/verify?email=doc%40clinic.ru&returnTo=%2Fevents%2Fkardio",
    );
  });

  it("021 EARS-10: re-encodes the guard's reconstruction, so an encoded segment survives one hop", () => {
    expect(withReturnTarget("/login", "/events/%D0%BA%D0%B0%D1%80%D0%B4%D0%B8%D0%BE")).toBe(
      "/login?returnTo=%2Fevents%2F%25D0%25BA%25D0%25B0%25D1%2580%25D0%25B4%25D0%25B8%25D0%25BE",
    );
  });

  it("021 EARS-10: yields the plain path when no target arrived", () => {
    expect(withReturnTarget("/login", null)).toBe("/login");
    expect(withReturnTarget("/login", undefined)).toBe("/login");
    expect(withReturnTarget("/login", "")).toBe("/login");
  });

  it("021 EARS-10: yields the plain path when the target is rejected, never the raw input", () => {
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/events/../../etc/passwd",
      "javascript:alert(1)",
    ]) {
      expect(withReturnTarget("/login", hostile)).toBe("/login");
    }
  });

  it("021 EARS-10: drops the query and fragment of the carried target", () => {
    expect(withReturnTarget("/register", "/events/kardio?utm=mail#agenda")).toBe(
      "/register?returnTo=%2Fevents%2Fkardio",
    );
  });
});
