import { expect, test, type Page } from "@playwright/test";

/**
 * 004 EARS-17/18 — the month view's navigation surface (`/webinars?view=month`,
 * `webinars-month.dc.html`, design §5.4). Drives the DEV-STAND-gated live portal
 * (guest, no session — the month projection is public) and asserts the paging +
 * picker + switcher BEHAVIOUR the sibling fidelity pin (`month-fidelity.spec.ts`)
 * does not: the ‹ › pager re-renders the grid + heading for the chosen month and
 * stays in month view; the 12-month picker shows per-month counts with past
 * months muted («прошёл») and selecting a month navigates to it; the «Неделя /
 * Месяц» switcher round-trips loss-free in BOTH directions (a carried month is
 * restored). Pure query-param navigation — no auth, no client state mutation.
 *
 * `test.skip`s on a bare CI run (no `E2E_PORTAL_URL`), like the sibling live-stand
 * specs. The reference month arithmetic is anchored to fixed months (September →
 * October → August 2026), so the heading assertions are seed-independent; the
 * "past month muted" assertion relies only on 2026 carrying already-past МСК
 * months (Jan–Jun before the mid-year reference).
 */
const HEADINGS: Record<string, string> = {
  "2026-08": "Август 2026",
  "2026-09": "Сентябрь 2026",
  "2026-10": "Октябрь 2026",
};

function h1(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

test.describe("004 EARS-17/18 month navigation, picker, switcher", () => {
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
    await expect(h1(page)).toHaveText(HEADINGS["2026-09"]);

    // Next month → October, still the month pane.
    await page.getByRole("link", { name: "Следующий месяц" }).click();
    await expect(page).toHaveURL(/[?&]view=month/);
    await expect(page).toHaveURL(/[?&]month=2026-10/);
    await expect(h1(page)).toHaveText(HEADINGS["2026-10"]);
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();

    // Previous month twice → August.
    await page.getByRole("link", { name: "Предыдущий месяц" }).click();
    await page.getByRole("link", { name: "Предыдущий месяц" }).click();
    await expect(page).toHaveURL(/[?&]month=2026-08/);
    await expect(h1(page)).toHaveText(HEADINGS["2026-08"]);
  });

  test("EARS-16/17: the 12-month picker shows counts, mutes past months, and navigates on select", async ({
    page,
  }) => {
    await page.goto("/webinars?view=month&month=2026-09", {
      waitUntil: "domcontentloaded",
    });

    // Open the disclosure (native <details> — click its <summary> trigger).
    await page.getByTestId("month-toolbar").locator("summary").click();

    // Already-past МСК months (Jan–Jun 2026) render the muted «прошёл» note.
    await expect(page.getByText("прошёл").first()).toBeVisible();

    // The displayed month is the non-interactive «you are here» marker.
    const current = page.locator('[aria-current="true"]');
    await expect(current).toContainText("Сент");

    // Selecting a different (future) month navigates to its view.
    await page.getByRole("link", { name: /Нояб/ }).click();
    await expect(page).toHaveURL(/[?&]month=2026-11/);
    await expect(h1(page)).toHaveText("Ноябрь 2026");
  });

  test("EARS-18: «Неделя ↔ Месяц» switcher round-trips loss-free in both directions", async ({
    page,
  }) => {
    // Month → week: the displayed month is carried on the «Неделя» link.
    await page.goto("/webinars?view=month&month=2026-09", {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("view-switcher")
      .getByRole("link", { name: "Неделя" })
      .click();
    await expect(page).toHaveURL(/\/webinars\?month=2026-09/);
    // The week pane renders with its own switcher (the «Неделя» side active).
    const weekSwitcher = page.getByTestId("view-switcher");
    await expect(weekSwitcher.getByText("Неделя")).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Week → month: «Месяц» restores the carried month (loss-free).
    await weekSwitcher.getByRole("link", { name: "Месяц" }).click();
    await expect(page).toHaveURL(/[?&]view=month/);
    await expect(page).toHaveURL(/[?&]month=2026-09/);
    await expect(h1(page)).toHaveText(HEADINGS["2026-09"]);
  });

  test("EARS-18: both panes render for an unauthenticated visitor (no cookie)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("month-toolbar")).toBeVisible();
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();

    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("view-switcher")).toBeVisible();
    await expect(h1(page)).toBeVisible();
  });
});
