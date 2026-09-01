/**
 * One-off UI-evidence capture for #1343 (014 EARS-5). Not a test — a screenshot
 * driver for the PR's `ui-render-*` / `ui-interactions` markers, run by hand
 * against the live pair. Kept out of `e2e/*.spec.ts` so Playwright never picks
 * it up as a spec.
 */

// `Event` is declared for ESLint because the `page.evaluate` body below is
// serialised and executed in the BROWSER, not in this Node process.
/* global Event */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_PORTAL_URL;
const ENDED = process.env.E2E_ENDED_WEBINAR_SLUG;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

async function shoot(browser, { name, viewport, theme, signedIn, after }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
    storageState: signedIn ? "e2e-1343-auth.json" : undefined,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/webinars/${ENDED}`, { waitUntil: "networkidle" });
  if (after) await after(page);
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
await authCtx.storageState({ path: "e2e-1343-auth.json" });
await authCtx.close();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: `gate-${viewport}-${theme}`, viewport, theme });
  }
}

await shoot(browser, {
  name: "interaction-player-signed-in-desktop-light",
  viewport: "desktop",
  theme: "light",
  signedIn: true,
});

await shoot(browser, {
  name: "interaction-player-unavailable-desktop-light",
  viewport: "desktop",
  theme: "light",
  signedIn: true,
  after: async (page) => {
    await page
      .locator("iframe")
      .first()
      .evaluate((el) => el.dispatchEvent(new Event("error")));
    await page.getByTestId("recording-player-unavailable").waitFor();
  },
});

await browser.close();
