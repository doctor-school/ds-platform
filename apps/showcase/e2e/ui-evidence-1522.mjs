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

// Interactions: a facet chip under the pointer, the name-search field focused,
// and the applied row of the full-set demo carrying its removable chips.
await shoot(browser, {
  name: "interactions-hover-and-focus",
  viewport: "desktop",
  theme: "light",
  after: async (page, section) => {
    await section
      .getByRole("button", { name: "Вебинар", exact: true })
      .first()
      .hover();
    await section.getByLabel("Поиск по названию").last().focus();
    await page.waitForTimeout(200);
  },
});

await browser.close();
