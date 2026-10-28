import { expect, test, type Page } from "@playwright/test";

/**
 * 004 EARS-18 — the month/feed switcher and public rendering (design §5.4).
 * The two directions preserve a carried month through the shared URL codec.
 * Pager and picker contracts now live in the shared 004 @public-calendar-states
 * journey; the sibling month-fidelity.spec.ts retains its separate boundaries.
 * Requires E2E_PORTAL_URL; both retained cases drive the guest surface.
 */
const HEADINGS: Record<string, string> = {
  "2026-09": "Сентябрь 2026",
};

/** The displayed month — the `MonthPicker` `<summary>` trigger in the toolbar. */
function shown(page: Page) {
  return page.getByTestId("month-toolbar").locator("summary");
}

test.describe("004 EARS-18 month switcher and public rendering", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual dev-stand gate",
  );

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("EARS-18: the month view and the feed view round-trip loss-free in both directions", async ({
    page,
  }) => {
    // Month → feed: «← Лента событий» keeps the displayed month on the ONE
    // codec (gate §4.3 D1) and drops only `view`.
    await page.goto("/webinars?view=month&month=2026-09", {
      waitUntil: "domcontentloaded",
    });
    const toFeed = page.getByTestId("events-view-switch");
    await expect(toFeed).toHaveText("← Лента событий");
    await toFeed.click();
    await expect(page).toHaveURL(/\/webinars\?month=2026-09$/);
    await expect(page.getByTestId("events-month-view")).toHaveCount(0);
    await expect(
      page.getByTestId("events-tense-tabs").getByRole("tab", { name: "Будущие" }),
    ).toHaveAttribute("aria-selected", "true");

    // Feed → month: «Календарь на месяц →» restores the carried month (loss-free).
    const toMonth = page.getByTestId("events-view-switch");
    await expect(toMonth).toHaveText("Календарь на месяц →");
    await toMonth.click();
    await expect(page).toHaveURL(/[?&]view=month/);
    await expect(page).toHaveURL(/[?&]month=2026-09/);
    await expect(shown(page)).toContainText(HEADINGS["2026-09"]);
  });

  test("EARS-18: the month pane and the feed view render for an unauthenticated visitor (no cookie)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("month-toolbar")).toBeVisible();
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();

    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("events-month-view")).toHaveCount(0);
    await expect(page.getByTestId("events-view-switch")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Расписание эфиров");
  });
});
