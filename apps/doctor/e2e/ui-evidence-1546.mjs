/**
 * One-off UI-evidence capture for #1546 (021 EARS-9 + EARS-10, the
 * post-confirmation success state). Not a test — a screenshot driver for the
 * PR marker block. Kept out of `e2e/*.spec.ts` so Playwright never collects it
 * as a spec. Mirrors `apps/doctor/e2e/ui-evidence-1547.mjs`.
 *
 * The render delta of this slice is the SUCCESS state that replaces the code
 * card, so the four resting frames shoot it in its from-gate composition (a
 * live return as the primary action, the cabinet secondary) and the
 * interaction frame shoots the degraded branch, where a stated reason stands
 * above the same pair.
 *
 *   pnpm --filter @ds/doctor build
 *   pnpm --filter @ds/doctor exec next start -p 3210
 *   E2E_DOCTOR_URL=http://127.0.0.1:3210 \
 *     node apps/doctor/e2e/ui-evidence-1546.mjs .github/ui-evidence/1546
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
 * `localStorage["ds-theme"]`. The OS-level `colorScheme` context option does
 * NOT switch this app theme.
 */
const THEME_STORAGE_KEY = "ds-theme";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";
const LIVE = "prp-pri-gonartroze";
const ENDED = "ended-vedenie-hronicheskoy-boli";

/** The confirm answers this driver stages, exactly as the layer-1 table shapes them. */
const ANSWERS = {
  live: {
    status: "verified",
    credited: null,
    profileCompletion: null,
    primaryAction: { kind: "return", href: `/events/${LIVE}` },
    secondaryAction: { kind: "cabinet", href: "/account" },
  },
  ended: {
    status: "verified",
    credited: null,
    profileCompletion: null,
    primaryAction: {
      kind: "landing",
      href: `/events/${ENDED}`,
      reason: "ended",
    },
    secondaryAction: { kind: "cabinet", href: "/account" },
  },
};

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

/**
 * Walk the door to the state under capture. The two write commands are staged
 * at the network edge: this driver captures a RENDER, and the upstream that
 * decides the landing has its own tier (`e2e/register-return.spec.ts`).
 */
async function reachSuccess(page, answer) {
  await page.route("**/v1/storefront/doctor/register", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending_verification" }),
    }),
  );
  await page.route("**/v1/storefront/doctor/confirm", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ANSWERS[answer]),
    }),
  );
  await page.goto(
    `${DOCTOR}/register?returnTo=${encodeURIComponent(`/webinars/${LIVE}`)}`,
    { waitUntil: "networkidle" },
  );
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  for (const testId of ["register-medworker", "register-partner-data"]) {
    await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  }
  await page.getByTestId("register-submit").click();
  await page.getByTestId("verify-submit").waitFor();
  await page.locator('input[autocomplete="one-time-code"]').fill("ABC123");
  await page.getByTestId("registration-success").waitFor();
}

async function shoot(browser, { name, viewport, theme, answer }) {
  const { ctx, page } = await open(browser, {
    viewport,
    theme,
    mobileDevice: viewport === "mobile",
  });
  await reachSuccess(page, answer);
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, {
      name: `${viewport}-${theme}`,
      viewport,
      theme,
      answer: "live",
    });
  }
}

await shoot(browser, {
  name: "interactions-degraded-ended",
  viewport: "desktop",
  theme: "light",
  answer: "ended",
});

await browser.close();
