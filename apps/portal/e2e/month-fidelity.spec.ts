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

      // The state legend — the three labelled swatches (colour is never the only
      // cue). Scoped to the legend container: the «В эфире» label also appears as
      // the sr-only text on every live pill, so a page-wide match is ambiguous
      // when the month carries live events.
      const legend = grid.getByTestId("grid-legend");
      await expect(legend.getByText("В эфире")).toBeVisible();
      await expect(legend.getByText("Запланирован")).toBeVisible();
      await expect(legend.getByText("Прошёл / пусто")).toBeVisible();

      // The «Неделя / Месяц» switcher — a real link back to the week listing + the
      // active pane. The «Неделя» link carries the displayed month so the week↔month
      // round-trip is loss-free (EARS-18, #1051) — `/webinars?month=YYYY-MM`.
      const switcher = page.getByTestId("view-switcher");
      await expect(switcher.getByRole("link", { name: "Неделя" })).toHaveAttribute(
        "href",
        /^\/webinars\?month=\d{4}-\d{2}$/,
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

    test(`EARS-19: canvas scale invariants — 11px pills, 118px cells, 1240px container, toolbar on hero (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);

      const grid = page.getByTestId("month-grid-desktop");
      await expect(grid).toBeVisible();

      // Pill scale — canvas line 234: computed font-size 11px (the #1052 gate
      // defect was the composed page falling back to base 16px).
      const pill = grid.locator("a[href^='/webinars/']").first();
      await expect(pill).toBeVisible();
      expect(await pill.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
        "11px",
      );

      // Cell scale — canvas line 233: min-height 118px.
      expect(
        await pill.evaluate(
          (el) => getComputedStyle(el.parentElement!.parentElement!).minHeight,
        ),
      ).toBe("118px");

      // Page column — canvas line 33: hero + main cap at max-width 1240px.
      const toolbar = page.getByTestId("month-toolbar");
      expect(
        await toolbar.evaluate(
          (el) => getComputedStyle(el.parentElement!).maxWidth,
        ),
      ).toBe("1240px");

      // Toolbar sits ON the hero band — canvas line 42 / 289: `main` pulls up
      // by 60px on desktop, so the toolbar's top edge overlaps the hero.
      const heroBox = await page.locator("main header").boundingBox();
      const toolbarBox = await toolbar.boundingBox();
      expect(heroBox).not.toBeNull();
      expect(toolbarBox).not.toBeNull();
      expect(toolbarBox!.y).toBeLessThan(heroBox!.y + heroBox!.height - 1);

      // No pill leaks past its own cell box (the recorded #1052 overflow defect
      // at 4 events/day) — every pill's border box stays inside its cell.
      const overflows = await grid.evaluate((root) => {
        const bad: string[] = [];
        for (const a of root.querySelectorAll("a[href^='/webinars/']")) {
          const cell = a.parentElement!.parentElement!;
          const cr = cell.getBoundingClientRect();
          const ar = a.getBoundingClientRect();
          if (
            ar.right > cr.right + 1 ||
            ar.left < cr.left - 1 ||
            ar.bottom > cr.bottom + 1
          ) {
            bad.push(a.textContent ?? "");
          }
        }
        return bad;
      });
      expect(overflows).toEqual([]);

      // Hero parity — canvas lines 35–38: no «МЕСЯЦ» kicker above the h1, the
      // right-side uppercase tagline present.
      const hero = page.locator("main header");
      await expect(hero.getByText(/^месяц$/i)).toHaveCount(0);
      await expect(hero.getByText("Врачи учат врачей")).toBeVisible();

      // Legend row — canvas line 155: the bottom-right accent link to the
      // nearest future month with events. Seed-deterministic: read the same
      // per-month counts the page composes from (the portal proxies `/v1/*`)
      // — the link renders iff a LATER month of the displayed МСК year carries
      // events, and is absent otherwise.
      const mskNow = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date());
      const mskYear = mskNow.find((p) => p.type === "year")!.value;
      const mskMonth = Number(mskNow.find((p) => p.type === "month")!.value);
      const counts = (await (
        await page.request.get(`/v1/public/events/month-counts?year=${mskYear}`)
      ).json()) as { month: number; count: number }[];
      const hasFutureMonth = counts.some(
        (c) => c.month > mskMonth && c.count > 0,
      );
      const nextMonthLink = page.getByTestId("next-month-link");
      if (hasFutureMonth) {
        await expect(nextMonthLink).toBeVisible();
      } else {
        await expect(nextMonthLink).toHaveCount(0);
      }

      // Pill cap (scope item 10, canvas update 2026-07-17): a desktop cell
      // renders at most 3 event pills, live-first; a 4+-events day appends the
      // «+N ещё» overflow link instead (the seed carries such a day).
      const moreLink = grid.getByText(/^\+\d+ ещё$/).first();
      await expect(moreLink).toBeVisible();
      const capViolations = await grid.evaluate((root) => {
        const bad: string[] = [];
        const cells = new Set<Element>();
        for (const a of root.querySelectorAll("a[href^='/webinars/']")) {
          cells.add(a.parentElement!.parentElement!);
        }
        for (const cell of cells) {
          const pills = cell.querySelectorAll("a[href^='/webinars/']").length;
          const more = [...cell.querySelectorAll("a")].some((a) =>
            /^\+\d+ ещё$/.test(a.textContent ?? ""),
          );
          if (pills > 3) bad.push(`cell with ${pills} pills`);
          if (more && pills !== 3) {
            bad.push(`overflow cell with ${pills} pills`);
          }
        }
        return bad;
      });
      expect(capViolations).toEqual([]);
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
