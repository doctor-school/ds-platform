/**
 * One-off UI-evidence capture for #1547 (021 EARS-11, the per-field validation
 * rules). Not a test — a screenshot driver for the PR's `ui-render-*` /
 * `ui-interactions` markers. Kept out of `e2e/*.spec.ts` so Playwright never
 * collects it as a spec. Mirrors `apps/doctor/e2e/ui-evidence-1663.mjs`.
 *
 * The render delta of this slice is the ERROR states — which sentence lands in
 * which slot — so the four resting frames shoot `/register` with every field
 * failing at once, and the interaction frames shoot the mobile confirmation
 * state where a lowercase code is typed into the untransformed slots.
 *
 *   pnpm --filter @ds/doctor build
 *   pnpm --filter @ds/doctor exec next start -p 3210
 *   E2E_DOCTOR_URL=http://127.0.0.1:3210 \
 *     node apps/doctor/e2e/ui-evidence-1547.mjs .github/ui-evidence/1547
 */

/* global localStorage, document */

import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const DOCTOR = process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3210";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

/**
 * The storefront theme is CLASS-based: `<html class="dark">` is the source of
 * truth, applied before first paint by the root layout FOUC guard from
 * `localStorage["ds-theme"]`. The OS-level `colorScheme` context option does NOT
 * switch this app theme — seeding the persisted choice through an init script is
 * what makes the guard add the class.
 */
const THEME_STORAGE_KEY = "ds-theme";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

async function open(browser, { viewport, theme, mobileDevice = false }) {
  const phone = devices["iPhone 13"];
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
    ...(mobileDevice
      ? {
          userAgent: phone.userAgent,
          isMobile: phone.isMobile,
          hasTouch: phone.hasTouch,
          deviceScaleFactor: phone.deviceScaleFactor,
        }
      : {}),
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
  const page = await ctx.newPage();
  return { ctx, page };
}

async function assertTheme(page, name, theme) {
  const rendersDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (rendersDark !== (theme === "dark")) {
    throw new Error(
      `${name}: expected the ${theme} theme, got ${rendersDark ? "dark" : "light"}`,
    );
  }
}

/** The render delta: all three door fields stating their own rule at once. */
async function shootFieldErrors(browser, { name, viewport, theme }) {
  const { ctx, page } = await open(browser, { viewport, theme });
  await page.goto(`${DOCTOR}/register`, { waitUntil: "networkidle" });

  for (const [testId, value] of [
    ["register-email", "doctor-at-clinic"],
    ["register-password", "short12"],
    ["register-promo", "D".repeat(65)],
  ]) {
    const input = page.getByTestId(testId);
    await input.waitFor();
    await input.fill(value);
    await input.blur();
  }
  await page.getByTestId("register-email").waitFor();
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

/** The mobile code entry: lowercase typed, slots untransformed. */
async function shootMobileCode(browser, { name, theme }) {
  const { ctx, page } = await open(browser, {
    viewport: "mobile",
    theme,
    mobileDevice: true,
  });
  await page.route("**/v1/storefront/doctor/register", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending_verification" }),
    }),
  );
  await page.goto(`${DOCTOR}/register`, { waitUntil: "networkidle" });
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  for (const testId of ["register-medworker", "register-partner-data"]) {
    await page
      .getByTestId(testId)
      .locator("xpath=ancestor::label[1]")
      .click();
  }
  await page.getByTestId("register-submit").click();
  await page.getByTestId("verify-submit").waitFor();
  // Five of six slots: the row is caught MID-entry, so the typed glyphs are
  // visible and no auto-submit has fired yet.
  await page.locator('input[autocomplete="one-time-code"]').fill("abc12");
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootFieldErrors(browser, {
      name: `${viewport}-${theme}`,
      viewport,
      theme,
    });
  }
}

for (const theme of ["light", "dark"]) {
  await shootMobileCode(browser, {
    name: `interactions-mobile-code-${theme}`,
    theme,
  });
}

await browser.close();
