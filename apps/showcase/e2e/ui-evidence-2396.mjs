/**
 * One-off UI-evidence capture for #2396 (@ds/design-system Sheet — the side
 * panel / record inspector). Not a test — a screenshot + axe driver for the PR's
 * `ui-render-*` / `ui-interactions` markers, run by hand against a live
 * showcase. Kept out of `e2e/*.spec.ts` so Playwright never picks it up.
 *
 *   E2E_SHOWCASE_URL=http://localhost:3396 node e2e/ui-evidence-2396.mjs <outDir>
 *
 * Exits non-zero on any axe violation in an OPEN sheet state (both themes) or
 * when ↑/↓ / Escape do not behave — the landing scan in a11y-axe.e2e.spec.ts
 * only ever sees the closed stages.
 */

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

// `localhost`, not `127.0.0.1`: Next 16 dev refuses an unlisted dev origin.
const BASE = process.env.E2E_SHOWCASE_URL ?? "http://localhost:3396";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const INSPECTOR = '[data-sheet-stage^="inspector"]';
const FORM = '[data-sheet-stage^="form"]';
let failures = 0;

async function open(browser, viewport, theme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/primitives`, { waitUntil: "networkidle" });
  // The catalogue re-themes by the `.dark` class on <html> (the #515 toggle).
  await page
    .locator("html")
    .evaluate(
      (html, dark) => html.classList.toggle("dark", dark),
      theme === "dark",
    );
  // One large client component: give dev hydration a beat before clicking.
  await page.waitForTimeout(3000);
  return { ctx, page };
}

async function axe(page, selector, label) {
  const { violations } = await new AxeBuilder({ page })
    .include(selector)
    .withTags(WCAG_TAGS)
    .analyze();
  if (violations.length) {
    failures += 1;
    console.error(
      `axe ${label}: ${violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`,
    );
  } else console.log(`axe ${label}: 0 violations`);
}

function fail(msg) {
  failures += 1;
  console.error(`FAIL ${msg}`);
}

const browser = await chromium.launch();

// Render shots: the inspector opened on a record — non-modal with the roster
// behind at 1440, modal full cover with the scrim at 390 — in both themes.
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await open(browser, viewport, theme);
    const stage = page.locator(INSPECTOR);
    await stage.scrollIntoViewIfNeeded();
    await stage.getByRole("button", { name: "Заявка №1042" }).click();
    const dialog = page.getByRole("dialog", { name: "Заявка №1042" });
    await dialog.waitFor();
    const modal = await dialog.getAttribute("data-modal");
    if (modal !== (viewport === "mobile" ? "true" : "false"))
      fail(`${viewport} data-modal=${modal}`);
    await page.waitForTimeout(400);
    await stage.screenshot({ path: `${OUT}/sheet-${viewport}-${theme}.png` });
    console.log(`captured sheet-${viewport}-${theme}.png`);
    await axe(page, INSPECTOR, `inspector ${viewport} ${theme}`);
    await ctx.close();
  }
}

// Form with footer actions, both themes (axe); the light desktop one is the shot.
for (const theme of ["light", "dark"]) {
  const { ctx, page } = await open(browser, "desktop", theme);
  const stage = page.locator(FORM);
  await stage.scrollIntoViewIfNeeded();
  await stage.getByRole("button", { name: "Новая заявка" }).click();
  await page.getByRole("dialog", { name: "Новая заявка" }).waitFor();
  await page.waitForTimeout(400);
  if (theme === "light") {
    await stage.screenshot({ path: `${OUT}/sheet-form-footer.png` });
    console.log("captured sheet-form-footer.png");
  }
  await axe(page, FORM, `form desktop ${theme}`);
  await ctx.close();
}

// Interaction: ↑/↓ on the open sheet pages the records, Escape closes.
{
  const { ctx, page } = await open(browser, "desktop", "light");
  const stage = page.locator(INSPECTOR);
  await stage.scrollIntoViewIfNeeded();
  await stage.getByRole("button", { name: "Заявка №1042" }).click();
  await page.getByRole("dialog", { name: "Заявка №1042" }).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  const title = page.getByRole("dialog").getByRole("heading");
  const text = await title.textContent();
  if (text !== "Заявка №1043")
    fail(`after ↓↓↑ title is "${text}", expected Заявка №1043`);
  else console.log("navigation: ↓↓↑ from №1042 lands on №1043");
  await page.waitForTimeout(300);
  await stage.screenshot({ path: `${OUT}/sheet-record-navigation.png` });
  console.log("captured sheet-record-navigation.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (await page.getByRole("dialog").count())
    fail("Escape did not close the sheet");
  else console.log("Escape: closed");
  await ctx.close();
}

await browser.close();
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
