import { expect, test, type Page } from "@playwright/test";

/**
 * 004 EARS-19 — the month-calendar view fidelity pin (`/webinars?view=month`,
 * `webinars-month.dc.html`, design §5.4). Drives the DEV-STAND-gated live portal
 * (guest, no session — the month projection is public) at BOTH breakpoints ×
 * BOTH themes, asserting the canvas STRUCTURE rather than pixels: the 7-column
 * desktop grid + its weekday header + state legend + «Неделя / Месяц» switcher;
 * the mobile dot-grid + selected-day agenda + day selection; the live signal
 * carried in text, never colour-only. `test.skip`s on a bare CI run (no
 * `E2E_PORTAL_URL`), like the sibling live-stand specs.
 *
 * Requires the month to carry seeded events (a live event today, a past event
 * earlier in the month, future events) — see the live-verify seeding recipe on
 * the PR. МСК-no-drift (EARS-12) is covered by the discovery МСК specs; the
 * month grid folds through the same pure helpers.
 */
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const THEMES = ["light", "dark"] as const;

async function applyTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle("dark", dark),
    theme === "dark",
  );
  await page.waitForTimeout(250);
}

test.describe("004 EARS-19 month-calendar view fidelity", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual dev-stand gate",
  );

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  for (const theme of THEMES) {
    test(`EARS-19: desktop 7-column grid, legend and switcher render (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);

      // The desktop grid pane (display-only calendar — no ARIA grid roles; the
      // weekday header + ≥35 day cells render as plain, contrast-safe markup).
      const grid = page.getByTestId("month-grid-desktop");
      await expect(grid).toBeVisible();
      await expect(grid.locator("a[href^='/webinars/']").first()).toBeVisible();

      // The month heading (МСК, capitalised — «<Месяц> <год>»).
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // The state legend — the three labelled swatches (colour is never the only cue).
      await expect(page.getByText("В эфире")).toBeVisible();
      await expect(page.getByText("Запланирован")).toBeVisible();
      await expect(page.getByText("Прошёл / пусто")).toBeVisible();

      // The «Неделя / Месяц» switcher — a real link back to the week listing + the active pane.
      const switcher = page.getByTestId("view-switcher");
      await expect(switcher.getByRole("link", { name: "Неделя" })).toHaveAttribute(
        "href",
        "/webinars",
      );
      await expect(switcher.getByText("Месяц")).toHaveAttribute(
        "aria-current",
        "page",
      );

      // Today is outlined + labelled «· сегодня» in the grid (independent of seed).
      await expect(grid.getByText(/· сегодня/)).toBeVisible();

      // At least one event pill links to an event page (EARS-8 pattern).
      await expect(
        grid.locator('a[href^="/webinars/"]').first(),
      ).toBeVisible();
    });

    test(`EARS-19: mobile dot-grid + agenda render and day selection works (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(MOBILE);
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);

      const mobile = page.getByTestId("month-calendar-mobile");
      await expect(mobile).toBeVisible();
      // The dot-grid renders one button per calendar cell (≥ 28 in-month + filler).
      const dayButtons = mobile.getByRole("button");
      expect(await dayButtons.count()).toBeGreaterThanOrEqual(28);

      // The selected-day agenda renders below the grid (default = today МСК).
      await expect(page.getByTestId("day-agenda")).toBeVisible();

      // Selecting an enabled in-month day updates the agenda without navigation.
      const urlBefore = page.url();
      const enabled = mobile.getByRole("button").filter({ hasNotText: "" });
      const target = enabled.nth(10);
      await target.click();
      await expect(target).toHaveAttribute("aria-pressed", "true");
      expect(page.url()).toBe(urlBefore); // client-side presentation state only
    });
  }
});
