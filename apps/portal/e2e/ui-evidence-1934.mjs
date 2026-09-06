/**
 * One-off UI-evidence capture for #1934 (both registration doors projecting the
 * ONE shared `<RegisterCard>` block). Not a test — a screenshot driver for the
 * PR's `ui-render-*` / `ui-interactions` markers. Kept out of `e2e/*.spec.ts` so
 * Playwright never collects it as a spec. Mirrors
 * `apps/doctor/e2e/ui-evidence-1541.mjs`.
 *
 * Neither `/register` route takes a backend read, so this runs against the plain
 * built apps — no api, no stand:
 *
 *   pnpm --filter @ds/portal build && pnpm --filter @ds/doctor build
 *   pnpm --filter @ds/portal exec next start -p 3310
 *   pnpm --filter @ds/doctor exec next start -p 3311
 *   E2E_PORTAL_URL=http://127.0.0.1:3310 E2E_DOCTOR_URL=http://127.0.0.1:3311 \
 *     node apps/portal/e2e/ui-evidence-1934.mjs .github/ui-evidence/1934
 *
 * The two hosts do NOT switch theme the same way, and the difference is load
 * bearing for the evidence: `apps/doctor` is CLASS-based (`<html class="dark">`
 * written before first paint from `localStorage["ds-theme"]`), so the OS-level
 * `colorScheme` context option alone is a no-op there; `apps/portal` keys off
 * `prefers-color-scheme`, which `colorScheme` does drive. Both are seeded here
 * and the resulting render is ASSERTED before every shot.
 */

/* global localStorage, document, window */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const PORTAL = process.env.E2E_PORTAL_URL ?? "http://127.0.0.1:3310";
const DOCTOR = process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3311";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

const THEME_STORAGE_KEY = "ds-theme";

async function context(browser, viewport, theme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  await ctx.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        throw new Error("ui-evidence: cannot seed the persisted theme choice");
      }
    },
    [THEME_STORAGE_KEY, theme],
  );
  return ctx;
}

/** The theme actually took — asserted rather than trusted, on either mechanism. */
async function assertTheme(page, name, theme) {
  const rendersDark = await page.evaluate(
    () =>
      document.documentElement.classList.contains("dark") ||
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  if (rendersDark !== (theme === "dark")) {
    throw new Error(
      `${name}: expected the ${theme} theme, got ${rendersDark ? "dark" : "light"}`,
    );
  }
}

async function shootDoctor(browser, { name, viewport, theme }) {
  const ctx = await context(browser, viewport, theme);
  const page = await ctx.newPage();
  await page.goto(`${DOCTOR}/register`, { waitUntil: "networkidle" });
  await page.getByTestId("registration-consent-access").waitFor();
  await assertTheme(page, name, theme);
  await page
    .getByTestId("registration-consent-marketing")
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

async function shootPortal(browser, { name, viewport, theme }) {
  const ctx = await context(browser, viewport, theme);
  const page = await ctx.newPage();
  await page.goto(`${PORTAL}/register`, { waitUntil: "networkidle" });
  await page.getByTestId("register-submit").waitFor();
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

/**
 * The ONE render delta this PR carries: the doctor door's form-level statement
 * now renders in the canonical `<FormError>`, which leads with the design
 * language's decorative warning glyph. Driven by refusing the register command
 * at the network boundary — the statement is what the visitor reads on a failed
 * submit, so that is the state worth photographing.
 */
async function shootDoctorFormError(browser) {
  const name = "interactions-form-error";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  await page.route("**/v1/storefront/doctor/register", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "registration unavailable" }),
    }),
  );
  await page.goto(`${DOCTOR}/register`, { waitUntil: "networkidle" });
  await page.getByTestId("registration-consent-access").waitFor();
  await page.getByTestId("register-email").fill("doc@example.com");
  await page.getByTestId("register-password").fill("Sup3r$ecretPw!9");
  for (const testId of ["register-medworker", "register-partner-data"]) {
    await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  }
  await page.getByTestId("register-submit").click();
  await page.getByTestId("register-command-error").waitFor();
  await page.getByTestId("register-command-error").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootDoctor(browser, {
      name: `${viewport}-${theme}`,
      viewport,
      theme,
    });
    await shootPortal(browser, {
      name: `portal-${viewport}-${theme}`,
      viewport,
      theme,
    });
  }
}

await shootDoctorFormError(browser);

await browser.close();
