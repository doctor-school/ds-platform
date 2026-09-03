/**
 * One-off UI-evidence capture for #1764 (020 EARS-1 slice 2, the event-page
 * composition blocks). Not a test — a screenshot driver for the PR's
 * `ui-render-*` / `ui-interactions` markers, run by hand against a live
 * showcase. Kept out of `e2e/*.spec.ts` so Playwright never picks it up.
 *
 *   E2E_SHOWCASE_URL=http://127.0.0.1:3331 node e2e/ui-evidence-1764.mjs <outDir>
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_SHOWCASE_URL ?? "http://127.0.0.1:3331";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function shoot(browser, { name, viewport, theme, target, after }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/blocks`, { waitUntil: "networkidle" });
  // The catalogue re-themes by the `.dark` class on <html> (the #515 runtime page
  // toggle), NOT by `prefers-color-scheme` — the context `colorScheme` above only
  // aligns UA form controls. Stamp the class exactly as `a11y-axe.e2e.spec.ts`
  // does, otherwise the "dark" shots come back byte-identical to the light ones.
  await page
    .locator("html")
    .evaluate((html, isDark) => html.classList.toggle("dark", isDark), theme === "dark");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Event page" }) })
    .first();
  await section.scrollIntoViewIfNeeded();
  const shot = target ? await target(page, section) : section;
  await shot.scrollIntoViewIfNeeded();
  if (after) await after(page, section);
  await shot.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

// The four render shots: the whole Event-page section (composed preview, the
// slots/props contract, and the six-CTA state matrix) at both breakpoints in
// both themes. At 390 the shell collapses to one column with the sign-up card
// FIRST, which is the ordering EARS-19 asks the evidence to show.
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: `${viewport}-${theme}`, viewport, theme });
  }
}

// Interactions: the sign-up CTA under the pointer (the raised ink-offset cast
// collapsing from 4px to 2px), the same CTA on keyboard focus-visible, and the
// speaker card's expert link on hover.
await shoot(browser, {
  name: "interactions-cta-hover",
  viewport: "desktop",
  theme: "light",
  target: (_page, section) => section.getByTestId("event-page-showcase"),
  after: async (_page, section) => {
    await section.getByTestId("event-signup-cta").first().hover();
  },
});

await shoot(browser, {
  name: "interactions-cta-focus",
  viewport: "desktop",
  theme: "dark",
  target: (_page, section) => section.getByTestId("event-page-showcase"),
  after: async (_page, section) => {
    await section.getByTestId("event-signup-cta").first().focus();
  },
});

await shoot(browser, {
  name: "interactions-speaker-link-hover",
  viewport: "desktop",
  theme: "light",
  target: (_page, section) => section.getByTestId("event-page-showcase"),
  after: async (_page, section) => {
    await section.getByTestId("event-speaker-footer-link").first().hover();
  },
});

await browser.close();
