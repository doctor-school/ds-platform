/**
 * One-off UI-evidence capture for #1541 (021 EARS-5, the two-tier consent
 * block). Not a test — a screenshot driver for the PR's `ui-render-*` /
 * `ui-interactions` markers. Kept out of `e2e/*.spec.ts` so Playwright never
 * collects it as a spec. Mirrors `apps/portal/e2e/ui-evidence-1345.mjs`.
 *
 * The registration route takes no backend read, so this runs against the plain
 * built app — no api, no stand:
 *
 *   pnpm --filter @ds/doctor build
 *   pnpm --filter @ds/doctor exec next start -p 3210
 *   E2E_DOCTOR_URL=http://127.0.0.1:3210 node apps/doctor/e2e/ui-evidence-1541.mjs .github/ui-evidence/1541
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3210";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

async function tick(page, testId) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
}

/**
 * The storefront theme is CLASS-based: `<html class="dark">` is the source of
 * truth (`apps/doctor/lib/theme.ts`), applied before first paint by the root
 * layout's FOUC guard from `localStorage["ds-theme"]`. The OS-level
 * `colorScheme` context option therefore does NOT switch this app's theme --
 * seeding the persisted choice through an init script (Playwright runs those
 * ahead of the page's own inline scripts) is what makes the guard add the class.
 */
const THEME_STORAGE_KEY = "ds-theme";

async function shoot(browser, { name, viewport, theme, granted }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  await ctx.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage unavailable in this context -- the guard then falls back to
        // the light default and the capture below would be wrong, so fail loud.
        throw new Error("ui-evidence: cannot seed the persisted theme choice");
      }
    },
    [THEME_STORAGE_KEY, theme],
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.getByTestId("registration-consent-access").waitFor();
  // The evidence is only honest if the theme actually took -- assert the class
  // the DS tokens key off rather than trusting the seeding to have worked.
  const rendersDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (rendersDark !== (theme === "dark")) {
    throw new Error(`${name}: expected the ${theme} theme, got ${rendersDark ? "dark" : "light"}`);
  }
  if (granted) {
    await tick(page, "register-medworker");
    await tick(page, "register-partner-data");
    await tick(page, "register-marketing");
  }
  // The block sits below the fields — the evidence is about the BLOCK, so
  // bring the marketing tier (its lower edge) into view before shooting.
  await page.getByTestId("registration-consent-marketing").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: `${viewport}-${theme}`, viewport, theme });
  }
}

// The interaction the clause is about: both access conditions granted, the
// marketing opt-in taken by choice, and the reason line moved on to the last
// real precondition.
await shoot(browser, {
  name: "interactions-consents-granted",
  viewport: "desktop",
  theme: "light",
  granted: true,
});

await browser.close();
