import { expect, test } from "@playwright/test";

/**
 * 019 EARS-4 (#1519) — the route-level proof that the month calendar stands
 * BESIDE the day feed (F-019-2 Б) and works as navigation over the same read.
 *
 * The three failures this guards are exactly the ones the handler names:
 *  1. a one-view-at-a-time switch — so both panes must be visible AT ONCE, and
 *     no «Неделя / Месяц» control may exist on the route;
 *  2. a screen-local selection model — so the day click must land in the
 *     ADDRESS BAR and move the feed body, not filter a list in memory;
 *  3. a document navigation that remounts 017's shell — so a `window` sentinel
 *     planted before the click must survive it. A full page load wipes the
 *     JavaScript realm; a soft navigation does not, which makes the sentinel a
 *     direct read of «without a full-page reload of the shell» rather than a
 *     proxy for it.
 *
 * «Moves the feed body» is MOVEMENT, not narrowing. `day` is URL state that
 * never narrows the read (`doctor-events-feed.schema.ts` — "Never narrows the
 * read", LD-1): the whole horizon stays served and the route scrolls the feed
 * to that day's `day-<ISO>` group anchor. When the chosen day lies beyond the
 * current horizon the day link ALSO widens `to=` through the codec — the same
 * «показать ещё» mechanism — so the day is inside the read it scrolls to. The
 * upstream double mirrors that exactly: it ignores `day` like the real service.
 *
 * The upstream is the fixed stand-in `e2e/support/doctor-events-api.mjs`: today
 * is 2026-09-01 (no events) and the live day is 2026-09-02, so the «сегодня»
 * marker and the live marker are asserted independently. Targeting arithmetic
 * and the month projection are owned by the api e2e spec, not by this tier.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const PLANNED_DAY = "2026-09-04";
const BEYOND_DAY = "2026-09-20";

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

test("EARS-4.2: selecting a day writes it into the URL and moves the feed body to that day without narrowing the read or reloading the shell", async ({
  page,
}) => {
  await page.goto("/events");

  const groups = page.locator('section[id^="day-"]');
  await expect(groups).toHaveCount(2);

  const selected = page.locator(`section[id="day-${PLANNED_DAY}"]`);
  const before = (await selected.boundingBox())?.y ?? 0;

  // Planted in the page's JavaScript realm; only a DOCUMENT navigation clears it.
  await page.evaluate(() => {
    (window as unknown as { __shellSentinel?: string }).__shellSentinel = "kept";
  });

  await page.getByRole("button", { name: /^4 сентября/ }).click();

  // 1. The selection is in the address bar — shareable, and the back button
  //    walks the feed's own states (LD-1, EARS-8).
  await expect(page).toHaveURL(new RegExp("day=" + PLANNED_DAY));

  // 2. The read was NOT narrowed: every day group the horizon serves is still
  //    rendered. `day` moves the body, it does not filter it.
  await expect(groups).toHaveCount(2);

  // 3. The body MOVED: the selected day's group is scrolled UP towards the top
  //    of the viewport and is in view — that is what «moves the feed body to
  //    that day» means. It is asserted as movement, not as an absolute offset,
  //    because a feed shorter than the viewport hits the document bottom before
  //    the group reaches y=0 and that is the honest outcome, not a failure.
  await expect
    .poll(async () => (await selected.boundingBox())?.y ?? Number.MAX_SAFE_INTEGER)
    .toBeLessThan(before);
  await expect(selected).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // 4. The shell was never remounted.
  const sentinel = await page.evaluate(
    () => (window as unknown as { __shellSentinel?: string }).__shellSentinel,
  );
  expect(sentinel).toBe("kept");

  // The calendar reflects the selection it caused, from the URL rather than
  // from a local state it kept beside the URL — and the cell is MARKED.
  await expect(page.locator("[data-events-month]")).toHaveAttribute(
    "data-selected-day",
    "4",
  );
  await expect(
    page.getByRole("button", { name: /^4 сентября/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("EARS-4.3: selecting a day beyond the current horizon widens `to=` so the day is inside the read it scrolls to", async ({
  page,
}) => {
  await page.goto("/events");

  // 2026-09-20 is outside the default 2026-09-01…15 window: its group is not
  // served yet, exactly as «показать ещё» would find it.
  await expect(page.locator(`section[id="day-${BEYOND_DAY}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: /^20 сентября/ }).click();

  await expect(page).toHaveURL(new RegExp(`day=${BEYOND_DAY}`));
  await expect(page).toHaveURL(/to=2026-09-2\d/);

  // Widening is the existing horizon mechanism, so the earlier days stay served
  // — the read GREW, it never narrowed.
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
  const selected = page.locator(`section[id="day-${BEYOND_DAY}"]`);
  await expect(selected).toBeVisible();
  await expect(selected).toBeInViewport();
});

test("EARS-4.4: a day with no events keeps the whole feed and lands on the nearest following day group", async ({
  page,
}) => {
  await page.goto("/events");

  await page.getByRole("button", { name: /^3 сентября/ }).click();

  await expect(page).toHaveURL(/day=2026-09-03/);
  // No fixture-only empty state: the honest feed stays whole and the body lands
  // on the nearest day the horizon actually serves.
  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  await expect(page.locator('section[id="day-2026-09-04"]')).toBeInViewport();
});
