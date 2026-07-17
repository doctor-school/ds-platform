import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** The current МСК `{ year, month }` (the page's displayed-month default). */
function mskNowYm(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === "year")!.value),
    month: Number(parts.find((p) => p.type === "month")!.value),
  };
}

/** `{year, month}` shifted by `delta` months (year boundary handled). */
function shiftYm(ym: { year: number; month: number }, delta: number) {
  const ordinal = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(ordinal / 12), month: (ordinal % 12) + 1 };
}

/**
 * The capitalised «Месяц год» title the portal composes (`formatMonthTitle`)
 * — Intl `ru-RU` long month + year, the « г.» era marker stripped.
 */
function ruMonthTitle(ym: { year: number; month: number }): string {
  const label = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    month: "long",
    year: "numeric",
  })
    .format(new Date(Date.UTC(ym.year, ym.month - 1, 15, 12)))
    .replace(/\s*г\.?$/, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Shading-rule sweep (owner rule, #1052 verdict #2): a cell carries the muted
 * calendar bg ⇔ it is a weekend column (сб/вс — indices 5/6) OR out-of-month
 * filler; every other cell — an EMPTY WEEKDAY included — stays transparent,
 * i.e. reads the card surface behind it. Out-of-month filler is derived from
 * the date labels: cells before the first «1» are the previous month's tail,
 * cells from the second «1» on are the next month's head.
 */
async function collectShadingViolations(grid: Locator): Promise<string[]> {
  return grid.evaluate((root) => {
    const rows = [
      ...root.querySelectorAll(".grid.grid-cols-7.border-b.border-hairline"),
    ];
    const cells = rows.flatMap((row) => [...row.children] as HTMLElement[]);
    const labels = cells.map((c) =>
      parseInt(c.querySelector("span")?.textContent ?? "", 10),
    );
    const firstDay1 = labels.indexOf(1);
    let secondDay1 = -1;
    for (let i = firstDay1 + 1; i < labels.length; i++) {
      if (labels[i] === 1) {
        secondDay1 = i;
        break;
      }
    }
    const bad: string[] = [];
    if (cells.length < 28 || firstDay1 === -1) {
      bad.push(`malformed grid: ${cells.length} cells, firstDay1=${firstDay1}`);
      return bad;
    }
    const TRANSPARENT = "rgba(0, 0, 0, 0)";
    cells.forEach((cell, i) => {
      const inMonth = i >= firstDay1 && (secondDay1 === -1 || i < secondDay1);
      const weekend = i % 7 >= 5;
      const expectMuted = weekend || !inMonth;
      const bg = getComputedStyle(cell).backgroundColor;
      const actualMuted = bg !== TRANSPARENT;
      if (actualMuted !== expectMuted) {
        bad.push(
          `cell ${i} (label ${labels[i]}, col ${i % 7}, inMonth=${inMonth}): bg=${bg}`,
        );
      }
    });
    return bad;
  });
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

    test(`EARS-19: canvas scale invariants — 11px pills, 118px cells, 1240px grid column, header/hero one blue, toolbar on hero (${theme})`, async ({
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

      // Pill title clamp — canvas `clamp2` (#1052 verdict #2): the pill's
      // inner text span computes `-webkit-line-clamp: 2` + `overflow: hidden`.
      const pillSpan = pill.locator("span.line-clamp-2");
      expect(
        await pillSpan.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { clamp: cs.webkitLineClamp, overflow: cs.overflow };
        }),
      ).toEqual({ clamp: "2", overflow: "hidden" });

      // …and no pill text span renders taller than two lines (2 × line-height
      // + 1px tolerance) — the clamp actually bites, not just declares.
      const tallSpans = await grid.evaluate((root) => {
        const bad: string[] = [];
        for (const s of root.querySelectorAll(
          "a[href^='/webinars/'] span.line-clamp-2",
        )) {
          const lh = parseFloat(getComputedStyle(s).lineHeight);
          if (s.getBoundingClientRect().height > 2 * lh + 1) {
            bad.push(s.textContent ?? "");
          }
        }
        return bad;
      });
      expect(tallSpans).toEqual([]);

      // Cell scale — canvas line 233: min-height 118px.
      expect(
        await pill.evaluate(
          (el) => getComputedStyle(el.parentElement!.parentElement!).minHeight,
        ),
      ).toBe("118px");

      // Page column — canvas line 44: `main` caps at 1240px of CONTENT with
      // the gutter outside (content-box). Tailwind preflight is border-box, so
      // the Container `calendar` cap is 1336px (1240 + 2 × 48px desktop-max
      // gutter, #1080 rework #3) and the canvas invariant is the GRID CONTENT
      // spanning the full 1240px at ≥1336px viewports.
      const toolbar = page.getByTestId("month-toolbar");
      expect(
        await toolbar.evaluate(
          (el) => getComputedStyle(el.parentElement!).maxWidth,
        ),
      ).toBe("1336px");
      const gridWidth = await grid.evaluate(
        (el) => el.getBoundingClientRect().width,
      );
      expect(Math.abs(gridWidth - 1240)).toBeLessThanOrEqual(0.5);

      // Toolbar sits ON the hero band — canvas line 42 / 289: `main` pulls up
      // by 60px on desktop, so the toolbar's top edge overlaps the hero.
      const heroBox = await page.locator("main header").boundingBox();
      const toolbarBox = await toolbar.boundingBox();
      expect(heroBox).not.toBeNull();
      expect(toolbarBox).not.toBeNull();
      expect(toolbarBox!.y).toBeLessThan(heroBox!.y + heroBox!.height - 1);

      // Trigger contrast (owner verdict #1, #1052): «Июль 2026 ▾» reads as a WHITE
      // bordered control on the navy hero — the Button `outline` surface (2px
      // border, an opaque non-blue fill), never the old filled-blue `<summary>`
      // (`bg-primary-action` = the hero blue #114D9E) that blended into the band.
      const trigger = toolbar.locator("summary");
      const triggerStyle = await trigger.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, borderWidth: cs.borderTopWidth };
      });
      expect(triggerStyle.borderWidth).toBe("2px");
      expect(triggerStyle.bg).not.toBe("rgb(17, 77, 158)");
      expect(triggerStyle.bg).not.toBe("rgba(0, 0, 0, 0)");

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

      // One continuous blue band — the app-shell header and the hero share the
      // same navy fill (owner verdict #4, #1085): #114D9E in BOTH themes — no
      // colour seam between the chrome bar and the poster band.
      const [shellBg, heroBg] = await page.evaluate(() => {
        const shell = document.querySelector("header")!;
        const heroBand = document.querySelector("main header")!;
        return [
          getComputedStyle(shell).backgroundColor,
          getComputedStyle(heroBand).backgroundColor,
        ];
      });
      expect(shellBg).toBe(heroBg);
      expect(shellBg).toBe("rgb(17, 77, 158)");

      // Header AA (owner verdict #4, #1085): the light band is now navy
      // blue.700 (#114D9E, white 8.14:1 full AA), so the desktop nav reverted
      // to its pre-#1083 size — computed 14px at weight ≥ 700 (the large-text
      // `text-xl` route of #1083 was rejected) — and the white chips carry the
      // canvas navy ink #114D9E in BOTH themes (8.14:1 on white).
      const navLink = page.getByTestId("shell-nav-broadcasts");
      const navStyle = await navLink.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
      });
      expect(navStyle.size).toBe(14);
      expect(navStyle.weight).toBeGreaterThanOrEqual(700);
      const loginChip = page.getByTestId("shell-login");
      await expect(loginChip).toBeVisible(); // guest run (cookies cleared)
      const chipStyle = await loginChip.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor };
      });
      expect(chipStyle.color).toBe("rgb(17, 77, 158)");
      expect(chipStyle.bg).toBe("rgb(255, 255, 255)");

      // Live-pill weight — canvas evLive (owner verdict #3 at #1052, #1080):
      // the red pill's `time · title` run computes weight 700 like a planned
      // pill (the seed carries a live event today).
      const livePill = grid
        .locator("a[href^='/webinars/']")
        .filter({ hasText: "В эфире" })
        .first();
      await expect(livePill).toBeVisible();
      expect(
        await livePill.evaluate((el) => getComputedStyle(el).fontWeight),
      ).toBe("700");

      // Hero parity — canvas lines 35–38: no «МЕСЯЦ» kicker above the h1, the
      // right-side uppercase tagline present.
      const hero = page.locator("main header");
      await expect(hero.getByText(/^месяц$/i)).toHaveCount(0);
      await expect(hero.getByText("Врачи учат врачей")).toBeVisible();

      // Legend row — canvas line 155 + owner rule (#1052 verdict #2): the
      // bottom-right accent link is ALWAYS the displayed month + 1, rendered
      // regardless of event data.
      const nextYm = shiftYm(mskNowYm(), 1);
      const nextMonthLink = page.getByTestId("next-month-link");
      await expect(nextMonthLink).toBeVisible();
      await expect(nextMonthLink).toHaveText(`${ruMonthTitle(nextYm)} →`);
      await expect(nextMonthLink).toHaveAttribute(
        "href",
        `/webinars?view=month&month=${nextYm.year}-${String(nextYm.month).padStart(2, "0")}`,
      );

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

    test(`EARS-19: shading rule + always-on next-month link on an empty far-future month (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);

      // Current (seeded) month — muted bg ⇔ weekend/out-of-month ONLY; an
      // empty WEEKDAY cell reads the card surface (transparent cell bg).
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);
      const grid = page.getByTestId("month-grid-desktop");
      await expect(grid).toBeVisible();
      expect(await collectShadingViolations(grid)).toEqual([]);

      // A far-future month with ZERO events (next МСК year, November): the
      // grid still renders, every weekday is empty and unshaded, and the
      // next-month link still renders as displayed + 1 («Декабрь <year+1> →»,
      // the always-on owner rule) — the old counts-conditional rendering
      // would have dropped it here.
      const farYear = mskNowYm().year + 1;
      await page.goto(`/webinars?view=month&month=${farYear}-11`, {
        waitUntil: "domcontentloaded",
      });
      await applyTheme(page, theme);
      const farGrid = page.getByTestId("month-grid-desktop");
      await expect(farGrid).toBeVisible();
      await expect(farGrid.locator("a[href^='/webinars/']")).toHaveCount(0);
      expect(await collectShadingViolations(farGrid)).toEqual([]);

      const farLink = page.getByTestId("next-month-link");
      await expect(farLink).toBeVisible();
      await expect(farLink).toHaveText(
        `${ruMonthTitle({ year: farYear, month: 12 })} →`,
      );
      await expect(farLink).toHaveAttribute(
        "href",
        `/webinars?view=month&month=${farYear}-12`,
      );
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

    test(`owner verdict #3: static shell — hero band + content column stay pixel-identical across a Неделя⇄Месяц round-trip (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });

      // The «Месяц» pane's shell.
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);
      await expect(page.getByTestId("month-toolbar")).toBeVisible();
      const monthHero = await page.locator("main header").boundingBox();
      const monthColumn = await page
        .getByTestId("month-toolbar")
        .evaluate((el) => {
          const r = el.parentElement!.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width };
        });
      const monthSwitcher = await page
        .getByTestId("view-switcher")
        .boundingBox();

      // The «Неделя» pane's shell — same CalendarShell, only the content swaps.
      await page.goto("/webinars", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);
      await expect(page.getByTestId("week-toolbar")).toBeVisible();
      const weekHero = await page.locator("main header").boundingBox();
      const weekColumn = await page
        .getByTestId("week-toolbar")
        .evaluate((el) => {
          const r = el.parentElement!.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width };
        });
      const weekSwitcher = await page.getByTestId("view-switcher").boundingBox();

      expect(monthHero).not.toBeNull();
      expect(weekHero).not.toBeNull();
      // The navy hero band: same position + width, same height (single-line copy).
      expect(weekHero!.x).toBeCloseTo(monthHero!.x, 0);
      expect(weekHero!.y).toBeCloseTo(monthHero!.y, 0);
      expect(weekHero!.width).toBeCloseTo(monthHero!.width, 0);
      expect(Math.abs(weekHero!.height - monthHero!.height)).toBeLessThanOrEqual(2);
      // The content column edges never jump (the 1104⇄1240 defect, owner item 3).
      expect(weekColumn.left).toBeCloseTo(monthColumn.left, 0);
      expect(weekColumn.right).toBeCloseTo(monthColumn.right, 0);
      expect(Math.abs(weekColumn.width - monthColumn.width)).toBeLessThanOrEqual(0.5);
      // The «Неделя / Месяц» switcher sits at the same top-right position in both.
      expect(monthSwitcher).not.toBeNull();
      expect(weekSwitcher).not.toBeNull();
      expect(weekSwitcher!.y).toBeCloseTo(monthSwitcher!.y, 0);
      expect(weekSwitcher!.x + weekSwitcher!.width).toBeCloseTo(
        monthSwitcher!.x + monthSwitcher!.width,
        0,
      );
    });

    test(`owner verdict #4: the picker year ‹ › pages in place — popover stays open, counters swap, no navigation (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);

      const picker = page.getByTestId("month-toolbar").locator("details");
      // Open the disclosure (native <details> — no client state for open/close).
      await picker.locator("summary").click();
      await expect(picker).toHaveJSProperty("open", true);

      const yearLabel = page.getByTestId("month-picker-year");
      const startYear = (await yearLabel.textContent())?.trim();
      const urlBefore = page.url();

      // Step a whole year forward — the current month sits mid-window, so the ›
      // step is an in-place client button (never the edge navigation link).
      await picker.getByRole("button", { name: "Следующий год" }).click();

      // The popover stayed open, the year + counters swapped, NOTHING navigated.
      await expect(picker).toHaveJSProperty("open", true);
      const endYear = (await yearLabel.textContent())?.trim();
      expect(endYear).not.toBe(startYear);
      expect(Number(endYear)).toBe(Number(startYear) + 1);
      expect(page.url()).toBe(urlBefore);
    });

    test(`owner verdict #5: the «← prev month» return link is absent on the current month, present on a future month, and navigates back (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);

      // Current month — the back link is withheld (never motivate going back).
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      await applyTheme(page, theme);
      await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
      await expect(page.getByTestId("prev-month-link")).toHaveCount(0);
      await expect(page.getByTestId("next-month-link")).toBeVisible();

      // A future month — the «← <current month>» return link renders on the left,
      // alongside the always-on next-month link, and points back to the prior month.
      const now = mskNowYm();
      const next = shiftYm(now, 1);
      const nextParam = `${next.year}-${String(next.month).padStart(2, "0")}`;
      const backParam = `${now.year}-${String(now.month).padStart(2, "0")}`;
      await page.goto(`/webinars?view=month&month=${nextParam}`, {
        waitUntil: "domcontentloaded",
      });
      await applyTheme(page, theme);
      const back = page.getByTestId("prev-month-link");
      await expect(back).toBeVisible();
      await expect(back).toHaveText(`← ${ruMonthTitle(now)}`);
      await expect(back).toHaveAttribute(
        "href",
        `/webinars?view=month&month=${backParam}`,
      );

      await back.click();
      await page.waitForURL(`**/webinars?view=month&month=${backParam}`);
      await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
    });
  }
});
