import { expect, test } from "@playwright/test";

/**
 * Wave-2 gate rows 56–57 (019 EARS-4 as amended 2026-10-05) — at ≥1024 px the
 * feed view of the one events page has a sticky left column: the compact
 * month dot grid with ‹ › ABOVE the facet panel. A day click moves the feed to
 * that day:
 *  1. through the ADDRESS BAR, not a screen-local selection;
 *  2. without a document navigation that would remount the shell — a `window`
 *     sentinel planted before the click must survive it;
 *  3. as MOVEMENT, not narrowing: `day` never narrows the read (LD-1), the
 *     page scrolls the feed to the day's `day-<ISO>` group; a day beyond the
 *     served extent widens `to=` through the codec (row 57).
 * In the month view the column holds the facet panel only.
 *
 * The upstream is the fixed stand-in `e2e/support/doctor-events-api.mjs`
 * (September 2026 fixtures), so every test names `month=2026-09`.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const SEPTEMBER = "/events?month=2026-09";
const PLANNED_DAY = "2026-09-04";
const BEYOND_DAY = "2026-09-20";

test("NEW: at ≥1024 px the feed view's column holds the compact month above the facet panel, beside the feed (row 56)", async ({
  page,
}) => {
  await page.goto(SEPTEMBER);

  const column = page.getByTestId("events-column");
  const compact = column.getByTestId("events-compact-month");
  const panel = column.getByRole("region", { name: "Фильтры" });
  await expect(compact).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("events-feed")).toBeVisible();
  await expect(compact).toHaveAttribute("data-month", "2026-09");
  const compactBox = (await compact.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(compactBox.y).toBeLessThan(panelBox.y);

  // Day labels state the events in the host noun (the canvas `dotWeeks`).
  await expect(
    compact.getByRole("button", { name: /^2 сентября.*, 2 события$/ }),
  ).toBeVisible();

  // The «Неделя / Месяц» switcher is retired (row 51).
  await expect(page.getByRole("button", { name: "Месяц" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Неделя" })).toHaveCount(0);

  // ‹ › page the compact month in place.
  await compact.getByTestId("events-compact-month-next").click();
  await expect(page).toHaveURL(/month=2026-10/);
  await expect(page.getByTestId("events-compact-month")).toHaveAttribute(
    "data-month",
    "2026-10",
  );
});

test("NEW: in the month view the column holds the facet panel only (row 56)", async ({
  page,
}) => {
  await page.goto("/events?view=month&month=2026-09");
  const column = page.getByTestId("events-column");
  await expect(column.getByRole("region", { name: "Фильтры" })).toBeVisible();
  await expect(column.getByTestId("events-compact-month")).toHaveCount(0);
});

test("EARS-4.2: selecting a day writes it into the URL and moves the feed body to that day without narrowing the read or reloading the shell", async ({
  page,
}) => {
  await page.goto(SEPTEMBER);

  const groups = page.locator('section[id^="day-"]');
  await expect(groups).toHaveCount(2);
  const selected = page.locator(`section[id="day-${PLANNED_DAY}"]`);
  const before = (await selected.boundingBox())?.y ?? 0;

  await page.evaluate(() => {
    (window as unknown as { __shellSentinel?: string }).__shellSentinel = "kept";
  });

  const compact = page.getByTestId("events-compact-month");
  await compact.getByRole("button", { name: /^4 сентября/ }).click();

  await expect(page).toHaveURL(new RegExp("day=" + PLANNED_DAY));
  await expect(groups).toHaveCount(2);
  await expect
    .poll(async () => (await selected.boundingBox())?.y ?? Number.MAX_SAFE_INTEGER)
    .toBeLessThan(before);
  await expect(selected).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const sentinel = await page.evaluate(
    () => (window as unknown as { __shellSentinel?: string }).__shellSentinel,
  );
  expect(sentinel).toBe("kept");

  await expect(compact).toHaveAttribute("data-selected-day", "4");
  await expect(
    compact.getByRole("button", { name: /^4 сентября/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("EARS-4.3: selecting a day beyond the current horizon widens `to=` so the day is inside the read it scrolls to (row 57)", async ({
  page,
}) => {
  await page.goto(SEPTEMBER);
  await expect(page.locator(`section[id="day-${BEYOND_DAY}"]`)).toHaveCount(0);

  await page
    .getByTestId("events-compact-month")
    .getByRole("button", { name: /^20 сентября/ })
    .click();

  await expect(page).toHaveURL(new RegExp(`day=${BEYOND_DAY}`));
  await expect(page).toHaveURL(/to=2026-09-2\d/);
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
  const selected = page.locator(`section[id="day-${BEYOND_DAY}"]`);
  await expect(selected).toBeVisible();
  await expect(selected).toBeInViewport();
});

test("EARS-4.4: a day with no events keeps the whole feed and lands on the nearest following day group", async ({
  page,
}) => {
  await page.goto(SEPTEMBER);

  await page
    .getByTestId("events-compact-month")
    .getByRole("button", { name: /^3 сентября/ })
    .click();

  await expect(page).toHaveURL(/day=2026-09-03/);
  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  await expect(page.locator('section[id="day-2026-09-04"]')).toBeInViewport();
});
