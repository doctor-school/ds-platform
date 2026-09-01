/**
 * One-off UI-evidence capture for #1522 (019 EARS-7, `EventsFilter`). Not a
 * test — a screenshot driver for the PR's `ui-render-*` / `ui-interactions`
 * markers, run by hand against a live showcase. Kept out of `e2e/*.spec.ts` so
 * Playwright never picks it up as a spec.
 *
 *   E2E_SHOWCASE_URL=http://localhost:3102 node e2e/ui-evidence-1522.mjs <outDir>
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_SHOWCASE_URL ?? "http://localhost:3102";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

async function shoot(browser, { name, viewport, theme, after }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/primitives`, { waitUntil: "networkidle" });
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Events-filter" }) })
    .first();
  await section.scrollIntoViewIfNeeded();
  if (after) await after(page, section);
  await section.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: `${viewport}-${theme}`, viewport, theme });
  }
}

// Interactions: the canvas option sheet OPEN under its facet button (the
// control language the owner approved), an option under the pointer, the
// name-search field focused, and the applied row of the full-set demo carrying
// its removable chips.
for (const theme of ["light", "dark"]) {
  await shoot(browser, {
    name: `interactions-option-sheet-${theme}`,
    viewport: "desktop",
    theme,
    after: async (page, section) => {
      // The applied/reset demo is the last one in the section. Only ONE sheet
      // can be out at a time now — a click outside a panel closes that panel's
      // sheet (the disclosure contract), and the two theme copies are two
      // independent panels — so each shot opens the copy of ITS OWN theme:
      // light → the first column, dark → the second.
      const applied = section.locator("> div").last();
      const controls = await applied
        .getByRole("button", { name: /^Формат:/ })
        .all();
      await controls[theme === "light" ? 0 : 1].click();
      await applied
        .getByRole("button", { name: "Конгресс", exact: true })
        .first()
        .hover();
      await page.waitForTimeout(200);
    },
  });
}

await shoot(browser, {
  name: "interactions-hover-and-focus",
  viewport: "desktop",
  theme: "light",
  after: async (page, section) => {
    await section
      .getByRole("button", { name: /^Город:/ })
      .last()
      .hover();
    await section.getByLabel("Поиск по названию").last().focus();
    await page.waitForTimeout(200);
  },
});

await browser.close();
