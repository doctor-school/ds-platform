import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { authLimitTagsFor } from "./default-auth-limits.js";

describe("EARS-13: default-limit browser contour selection", () => {
  it("excludes default-limit cases from both ordinary storefront contours", () => {
    expect(authLimitTagsFor("academy", {})).toBe(
      "(@host:academy or @host:both) and not @default-auth-limits and not @public-feed-entry",
    );
    expect(authLimitTagsFor("doctor", {})).toBe(
      "(@host:doctor or @host:both) and not @default-auth-limits and not @public-feed-entry",
    );
  });
  it("EARS-1: keeps the task-owned feed-entry contour out of ordinary local and stage selections", () => {
    const require = createRequire(import.meta.url);
    const parse = createRequire(require.resolve("playwright-bdd"))(
      "@cucumber/tag-expressions",
    ).default as (value: string) => { evaluate(tags: string[]): boolean };
    for (const env of [
      {},
      { E2E_PORTAL_URL: "https://pr-3756.stage.doctor.school" },
    ]) {
      const ordinary = parse(authLimitTagsFor("doctor", env));
      expect(ordinary.evaluate(["@host:doctor", "@public-feed-entry"])).toBe(
        false,
      );
      expect(
        ordinary.evaluate(["@host:doctor", "@public-specialty-catalog"]),
      ).toBe(true);
    }
    const dedicated = parse("@host:doctor and @public-feed-entry");
    expect(dedicated.evaluate(["@host:doctor", "@public-feed-entry"])).toBe(
      true,
    );
    expect(dedicated.evaluate(["@host:academy", "@public-feed-entry"])).toBe(
      false,
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
