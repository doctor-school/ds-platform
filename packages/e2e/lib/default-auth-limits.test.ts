import { describe, expect, it } from "vitest";
import { authLimitTagsFor } from "./default-auth-limits.js";

describe("EARS-13: default-limit browser contour selection", () => {
  it("excludes default-limit cases from both ordinary storefront contours", () => {
    expect(authLimitTagsFor("academy", {})).toBe(
      "(@host:academy or @host:both) and not @default-auth-limits",
    );
    expect(authLimitTagsFor("doctor", {})).toBe(
      "(@host:doctor or @host:both) and not @default-auth-limits",
    );
  });
  it.each([
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
  ])("selects only tagged Academy cases on %s", (url) => {
    const env = { E2E_AUTH_LIMIT_TIER: "default", E2E_PORTAL_URL: url };
    expect(authLimitTagsFor("academy", env)).toBe(
      "(@host:academy or @host:both) and @default-auth-limits",
    );
    expect(authLimitTagsFor("doctor", env)).toBe(
      "@host:doctor and not @host:doctor",
    );
  });
  it.each(["", "stage", "defaults"])("refuses unknown tier %j", (tier) => {
    expect(() =>
      authLimitTagsFor("academy", { E2E_AUTH_LIMIT_TIER: tier }),
    ).toThrow("E2E_AUTH_LIMIT_TIER");
  });
  it.each([
    undefined,
    "https://main.stage.doctor.school",
    "https://academy.doctor.school",
    "http://localhost.evil.test",
    "ftp://localhost",
    "http://user:pass@localhost",
    "not-a-url",
  ])("refuses default-tier target %j before browser execution", (url) => {
    expect(() =>
      authLimitTagsFor("academy", {
        E2E_AUTH_LIMIT_TIER: "default",
        ...(url === undefined ? {} : { E2E_PORTAL_URL: url }),
      }),
    ).toThrow("loopback E2E_PORTAL_URL");
  });
});
