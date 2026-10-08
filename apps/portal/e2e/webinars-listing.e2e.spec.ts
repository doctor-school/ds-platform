import { test, expect } from "@playwright/test";

/**
 * 004 EARS-11 — retained empty-state coverage; needs a branch DB without upcoming
 * events. EARS-7/8 public discovery now lives in 004-scenarios.feature and
 * packages/e2e/steps/webinar-discovery.steps.ts (#2249).
 */
const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const EXPECTED_EMPTY = process.env.E2E_WEBINARS_EMPTY === "1";

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

test("EARS-11: with no upcoming event, the listing renders the empty-state", async ({
  page,
}) => {
  test.skip(!EXPECTED_EMPTY, "requires a branch DB with no upcoming events");
  await page.goto(`${BASE}/webinars`, { waitUntil: "domcontentloaded" });
  // The feed view's empty state (gate row 47): with no facet applied it names
  // none — «Эфиров нет».
  const empty = page.getByTestId("events-feed-empty");
  await expect(empty).toBeVisible();
  await expect(empty.getByText("Эфиров нет", { exact: true })).toBeVisible();
});
