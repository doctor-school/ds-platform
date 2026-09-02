import { expect, test } from "@playwright/test";

/**
 * 019 EARS-4 (#1519) — the route-level proof that the month calendar stands
 * BESIDE the day feed (F-019-2 Б) and works as navigation over the same read.
 *
 * The three failures this guards are exactly the ones the handler names:
 *  1. a one-view-at-a-time switch — so both panes must be visible AT ONCE, and
 *     no «Неделя / Месяц» control may exist on the route;
 *  2. a screen-local selection model — so the day click must land in the
 *     ADDRESS BAR and narrow the served feed, not filter a list in memory;
 *  3. a document navigation that remounts 017's shell — so a `window` sentinel
 *     planted before the click must survive it. A full page load wipes the
 *     JavaScript realm; a soft navigation does not, which makes the sentinel a
 *     direct read of «without a full-page reload of the shell» rather than a
 *     proxy for it.
 *
 * The upstream is the fixed stand-in `e2e/support/doctor-events-api.mjs`: today
 * is 2026-09-01 (no events) and the live day is 2026-09-02, so the «сегодня»
 * marker and the live marker are asserted independently. Targeting arithmetic
 * and the month projection are owned by the api e2e spec, not by this tier.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const PLANNED_DAY = "2026-09-04";

test("EARS-4.1: the month calendar and the day feed are shown at once on desktop, «Сегодня» and the live day marked", async ({
  page,
}) => {
  await page.goto("/events");

  const calendar = page.locator("[data-events-month]");
  const feed = page.locator("[data-events-feed]");

  // «Shown at once» is the whole clause — neither pane replaces the other.
  await expect(calendar).toBeVisible();
  await expect(feed).toBeVisible();
  await expect(calendar).toHaveAttribute("data-month", "2026-09");

  // The markers are accessible text, never colour alone (WCAG 1.4.1): the dots
  // are decorative and the day button's label carries both signals.
  await expect(
    page.getByRole("button", { name: /^1 сентября, сегодня/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^2 сентября,.*идёт эфир$/ }),
  ).toBeVisible();

  // Under F-019-2 Б the one-view-at-a-time switch is not built at all.
  await expect(page.getByRole("button", { name: "Месяц" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Неделя" })).toHaveCount(0);
});

test("EARS-4.2: selecting a day writes it into the URL and moves the feed body without reloading the shell", async ({
  page,
}) => {
  await page.goto("/events");

  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);

  // Planted in the page's JavaScript realm; only a DOCUMENT navigation clears it.
  await page.evaluate(() => {
    (window as unknown as { __shellSentinel?: string }).__shellSentinel = "kept";
  });

  await page.getByRole("button", { name: /^4 сентября/ }).click();

  // 1. The selection is in the address bar — shareable, and the back button
  //    walks the feed's own states (LD-1, EARS-8).
  await expect(page).toHaveURL(new RegExp(`/events\\?.*day=${PLANNED_DAY}`));

  // 2. The BODY moved: the served feed is narrowed to the selected day.
  const groups = page.locator('section[id^="day-"]');
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toHaveAttribute("id", `day-${PLANNED_DAY}`);

  // 3. The shell was never remounted.
  const sentinel = await page.evaluate(
    () => (window as unknown as { __shellSentinel?: string }).__shellSentinel,
  );
  expect(sentinel).toBe("kept");

  // The calendar reflects the selection it caused, from the URL rather than
  // from a local state it kept beside the URL.
  await expect(page.locator("[data-events-month]")).toHaveAttribute(
    "data-selected-day",
    "4",
  );
});
