/**
 * One-off UI-evidence capture for #1345 (014 EARS-8). Not a test — a screenshot
 * driver for the PR's `ui-render-*` / `ui-interactions` markers, run by hand
 * against the live pair. Kept out of `e2e/*.spec.ts` so Playwright never picks
 * it up as a spec. Mirrors `ui-evidence-1343.mjs`.
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_PORTAL_URL;
const BOTH_CUTS = process.env.E2E_BOTH_CUTS_WEBINAR_SLUG;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

async function shoot(browser, { name, viewport, theme, open }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
    storageState: "e2e-1345-auth.json",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/webinars/${BOTH_CUTS}`, {
    waitUntil: "networkidle",
  });
  // The spoiler sits under the player card, below the fold on mobile — the
  // evidence is about the SPOILER, so scroll it into view before shooting.
  const spoiler = page.getByTestId("recording-spoiler");
  await spoiler.waitFor();
  if (open) {
    await spoiler.locator("summary").click();
    await page.locator('[data-testid="recording-spoiler"] iframe').waitFor();
    await page.waitForTimeout(1500);
  }
  await spoiler.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

// A stored session, so the signed-in shots do not re-run the login each time.
const authCtx = await browser.newContext();
const authPage = await authCtx.newPage();
await authPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await authPage
  .getByRole("textbox", { name: /почта|email/i })
  .fill(process.env.E2E_DOCTOR_EMAIL);
await authPage
  .getByRole("textbox", { name: /пароль|password/i })
  .fill(process.env.E2E_DOCTOR_PASSWORD);
await authPage.getByRole("button", { name: /войти|продолжить/i }).click();
await authPage.waitForURL(/\/account|\/webinars/);
await authCtx.storageState({ path: "e2e-1345-auth.json" });
await authCtx.close();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: `${viewport}-${theme}`, viewport, theme });
  }
}

await shoot(browser, {
  name: "interactions-spoiler",
  viewport: "desktop",
  theme: "light",
  open: true,
});

await browser.close();
