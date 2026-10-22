import { test, expect } from "@playwright/test";

/**
 * 021 EARS-3 (#1539) — the LD-4 destinations of a direct arrival resolve on
 * THIS app. The door that publishes them renders on the sign-in host now
 * (#3172, `apps/login/e2e/doctor-register-direct.e2e.spec.ts`), and which one
 * a confirmed doctor lands on is the storefront callback's decision (stand
 * journeys, `packages/e2e`); the pages themselves are this storefront's, so
 * their proof stays here, against `e2e/support/return-context-api.mjs`.
 */
const EVENTS_FEED = "/events";
const HOME = "/";

test.describe("021 EARS-3: LD-4 — where the direct arrival lands", () => {
  test("021 EARS-3.6: both landings resolve on this app — neither branch points at a dead path", async ({
    page,
  }) => {
    for (const landing of [HOME, EVENTS_FEED]) {
      const response = await page.goto(landing);
      expect(response?.status(), `${landing} must resolve`).toBe(200);
    }
  });
});
