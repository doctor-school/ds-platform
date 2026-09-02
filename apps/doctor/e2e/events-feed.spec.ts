import { expect, test } from "@playwright/test";

/**
 * 019 EARS-3 (#1518) — the route-level proof that `doctor.school/events` renders
 * the feed as DAY GROUPS and that «Показать ещё» widens the horizon in the URL.
 *
 * Both assertions are deliberately about the URL and the DOM structure rather
 * than about copy: the failure this guards is a screen-local listing engine
 * (EARS-15) — a control that pages in memory would leave the address bar
 * unchanged, and a screen-local grouping would not emit the shared unit's
 * `#day-<YYYY-MM-DD>` sections. The upstream is a fixed stand-in
 * (`e2e/support/doctor-events-api.mjs`); targeting and adjacency are proven
 * against the real database in the api e2e spec, not here.
 */
const DEFAULT_FROM = "2026-09-01";
const DEFAULT_TO = "2026-09-15";
const WIDENED_TO = "2026-09-29";

test("EARS-3: the feed renders its days as groups over the served horizon", async ({
  page,
}) => {
  await page.goto("/events");

  const feed = page.locator("[data-events-feed]");
  await expect(feed).toHaveAttribute("data-feed-from", DEFAULT_FROM);
  await expect(feed).toHaveAttribute("data-feed-to", DEFAULT_TO);

  // One section per day, in the order the contract served them — the grouping
  // is the shared unit's, keyed by the calendar day.
  const groups = page.locator('section[id^="day-"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute("id", "day-2026-09-02");
  await expect(groups.nth(1)).toHaveAttribute("id", "day-2026-09-04");
  await expect(groups.nth(0).getByText("Событие evt-1")).toBeVisible();
});

test("EARS-3: «Показать ещё» extends the range in the URL, not in memory", async ({
  page,
}) => {
  await page.goto("/events");

  await page.getByTestId("events-feed-show-more").click();

  await expect(page).toHaveURL(
    new RegExp(`/events\\?.*from=${DEFAULT_FROM}.*to=${WIDENED_TO}`),
  );

  const feed = page.locator("[data-events-feed]");
  await expect(feed).toHaveAttribute("data-feed-to", WIDENED_TO);
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);

  // The horizon is maximal now (`nextTo: null`), so the control is gone rather
  // than disabled — there is no paging state left to hold.
  await expect(page.getByTestId("events-feed-show-more")).toHaveCount(0);
});
