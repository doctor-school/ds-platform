/**
 * One-off UI-evidence capture for #1996 (021 EARS-15, the post-confirmation
 * sign-in). Not a test — a screenshot driver for the PR's `ui-render-*` /
 * `ui-interactions` markers. Kept out of `e2e/*.spec.ts` so Playwright never
 * collects it as a spec. Mirrors `apps/doctor/e2e/ui-evidence-1547.mjs`.
 *
 * The render delta of this slice is NOT a new element — it is the STATE the
 * doctor lands in: after the code is typed, the header of the эфир page the
 * success card sends them to carries the signed-in cluster («Личный кабинет»)
 * instead of «Войти». The four resting frames therefore shoot that landed page,
 * driven through the whole journey (door → code → success card → primary), and
 * the interaction frame shoots the success card itself mid-journey.
 *
 * It runs against the same upstream double the return-context tier boots
 * (`e2e/support/return-context-api.mjs`), because the header is resolved on the
 * SERVER from the `__Host-ds_session` cookie the replayed login sets — a
 * browser-level fixture could not produce it.
 *
 *   pnpm --filter @ds/doctor build
 *   DOCTOR_FAKE_API_PORT=3311 node apps/doctor/e2e/support/return-context-api.mjs &
 *   API_PROXY_TARGET=http://127.0.0.1:3311 \
 *     pnpm --filter @ds/doctor exec next start -p 3310
 *   E2E_DOCTOR_URL=http://localhost:3310 \
 *     node apps/doctor/e2e/ui-evidence-1996.mjs .github/ui-evidence/1996
 */

/* global localStorage, document */

import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const DOCTOR = process.env.E2E_DOCTOR_URL ?? "http://localhost:3310";
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

/** The live эфир the double answers for — the same fixture the tier uses. */
const LIVE = "prp-pri-gonartroze";
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

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page, testId) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
}

/**
 * Walk the whole journey the way the tier does: the canonical academy gate
 * arrival, the door, then the code. The slotted OTP field auto-submits on
 * completion (#175), so filling it IS the confirm.
 */
async function registerAndConfirm(page) {
  const arrival = `/register?${new URLSearchParams({ returnTo: `/webinars/${LIVE}` })}`;
  await page.goto(`${DOCTOR}${arrival}`, { waitUntil: "networkidle" });
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();
  await page.getByTestId("verify-submit").waitFor();
  await page.locator('input[autocomplete="one-time-code"]').fill("ABC123");
  await page.getByTestId("registration-success").waitFor();
}

/** The render delta: the landed эфир page, header in the signed-in state. */
async function shootSignedInLanding(browser, { name, viewport, theme }) {
  const { ctx, page } = await open(browser, {
    viewport,
    theme,
    mobileDevice: viewport === "mobile",
  });
  await registerAndConfirm(page);
  await page.getByTestId("registration-success-primary").click();
  await page.waitForURL(new RegExp(`/events/${LIVE}$`));
  const header = page.getByTestId("storefront-header");
  await header.getByRole("link", { name: "Личный кабинет" }).waitFor();
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

/** The interaction frame: the success card the replayed login sits behind. */
async function shootSuccessCard(browser, { name, theme }) {
  const { ctx, page } = await open(browser, { viewport: "desktop", theme });
  await registerAndConfirm(page);
  await page.getByTestId("registration-success-primary").waitFor();
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootSignedInLanding(browser, {
      name: `${viewport}-${theme}`,
      viewport,
      theme,
    });
  }
}

await shootSuccessCard(browser, {
  name: "interactions-success-card-light",
  theme: "light",
});

await browser.close();
