import { expect, test, type Page } from "@playwright/test";

/**
 * 004 EARS-17/18 — the month view's navigation surface (`/webinars?view=month`,
 * `events-feed-month.dc.html`, design §5.4). Drives the DEV-STAND-gated live portal
 * (guest, no session — the month projection is public) and asserts the paging +
 * picker + switcher BEHAVIOUR the sibling fidelity pin (`month-fidelity.spec.ts`)
 * does not: the ‹ › pager re-renders the grid + heading for the chosen month and
 * stays in month view; the 12-month picker shows per-month counts with past
 * empty past months «архив» and selecting a month navigates to it; the month
 * view's «← Лента событий» and the feed view's «Календарь на месяц →» round-trip
 * loss-free in BOTH directions (a carried month is restored). Pure query-param navigation — no auth, no client state mutation.
 *
 * `test.skip`s on a bare CI run (no `E2E_PORTAL_URL`), like the sibling live-stand
 * specs. The reference month arithmetic is anchored to fixed months (September →
 * October → August 2026), so the heading assertions are seed-independent; the
 * "архив" assertion relies only on 2026 carrying empty already-past МСК
 * months (Jan–Jun before the mid-year reference).
 */
const HEADINGS: Record<string, string> = {
  "2026-08": "Август 2026",
  "2026-09": "Сентябрь 2026",
  "2026-10": "Октябрь 2026",
};

/** The displayed month — the `MonthPicker` `<summary>` trigger in the toolbar. */
function shown(page: Page) {
  return page.getByTestId("month-toolbar").locator("summary");
}

test.describe("004 EARS-17/18 month navigation, picker, switcher", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual dev-stand gate",
  );

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("EARS-17: ‹ › pager re-renders the grid + heading and stays in month view", async ({
    page,
  }) => {
    await page.goto("/webinars?view=month&month=2026-09", {
      waitUntil: "domcontentloaded",
    });
    await expect(shown(page)).toContainText(HEADINGS["2026-09"]);

    // Next month → October, still the month pane.
    await page.getByTestId("month-next").click();
    await expect(page).toHaveURL(/[?&]view=month/);
    await expect(page).toHaveURL(/[?&]month=2026-10/);
    await expect(shown(page)).toContainText(HEADINGS["2026-10"]);
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();

    // Previous month twice → August.
    await page.getByTestId("month-prev").click();
    await expect(page).toHaveURL(/[?&]month=2026-09/);
    await page.getByTestId("month-prev").click();
    await expect(page).toHaveURL(/[?&]month=2026-08/);
    await expect(shown(page)).toContainText(HEADINGS["2026-08"]);
  });

  test("EARS-16/17: the 12-month picker shows counts, mutes past months, and navigates on select", async ({
    page,
  }) => {
    await page.goto("/webinars?view=month&month=2026-09", {
      waitUntil: "domcontentloaded",
    });

    // Open the disclosure (native <details> — click its <summary> trigger).
    await shown(page).click();

    // An empty already-past МСК month (Jan–Jun 2026) reads «архив» (canvas `K.pickerFor`).
    await expect(page.getByTestId("month-toolbar").getByText("архив").first()).toBeVisible();

    // The displayed month is the non-interactive «you are here» marker.
    const current = page.locator('[aria-current="true"]');
    await expect(current).toContainText("Сент");

    // Selecting a different (future) month navigates to its view.
    await page.getByTestId("month-toolbar").getByRole("link", { name: /Нояб/ }).click();
    await expect(page).toHaveURL(/[?&]month=2026-11/);
    await expect(shown(page)).toContainText("Ноябрь 2026");
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
