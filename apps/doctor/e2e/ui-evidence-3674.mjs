/**
 * One-off UI-evidence capture for #3674 (017 EARS-1 / EARS-7 — «Моя лента» in
 * the doctor header and the ways into the 018 specialty feed). Not a test — a
 * screenshot driver for the PR's `ui-render-*` / `ui-interactions` markers,
 * kept out of `e2e/*.spec.ts` so Playwright never collects it. Mirrors
 * `apps/doctor/e2e/ui-evidence-2031.mjs`.
 *
 * Boot the events-tier topology of `playwright.events.config.ts` against the
 * production build (built with `API_PROXY_TARGET=http://127.0.0.1:3214`): the
 * stand-in `e2e/support/doctor-events-api.mjs` on 3214, the storefront double
 * on 3217 and `next start -H 0.0.0.0 -p 3213`, then:
 *
 *   E2E_DOCTOR_URL=http://localhost:3213 \
 *     node apps/doctor/e2e/ui-evidence-3674.mjs .github/ui-evidence/3674
 *
 * `localhost`, never `127.0.0.1`: Next answers 403 to an unlisted origin, the
 * page never hydrates and the driven controls silently do nothing.
 */

/* global localStorage, document, window */
// The identifiers above are referenced only inside `page.evaluate` callbacks,
// which run in the BROWSER, not in this Node process.

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";

const BASE = process.env.E2E_DOCTOR_URL ?? "http://localhost:3213";
const OUT = process.argv[2] ?? ".github/ui-evidence/3674";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const THEME_STORAGE_KEY = "ds-theme";
/** The events stand-in's feed fixture specialty (`doctor-events-api.mjs`). */
const REMEMBERED_ID = "0b8f1c52-5d0e-4c55-9d1f-1a2b3c4d5e6f";
const FEED_PATH = "/feed/travmatologiya-i-ortopediya";

const results = [];
function verdict(ok, line) {
  results.push({ ok, line });
  console.log((ok ? "PASS " : "FAIL ") + line);
}

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

async function assertTheme(page, name, theme) {
  const rendersDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (rendersDark !== (theme === "dark")) {
    throw new Error(`${name}: expected the ${theme} theme`);
  }
}

/**
 * «Моя лента» driven from the home with a remembered specialty: the shot is
 * the feed it lands on, with the header item in frame (on mobile, inside the
 * opened ≡ menu).
 */
async function shootMyFeed(browser, { viewport, theme }) {
  const name = `${viewport}-${theme}`;
  const ctx = await context(browser, viewport, theme);
  const page = await ctx.newPage();
  // The browser is launched treating this http origin as secure, so the
  // remembered guest choice sits in the jar as the `__Host-` cookie, beside
  // the theme cookie the shell writes (a static extra header would lose to
  // the jar). It is written from the page, then the home is re-opened with it.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate((id) => {
    document.cookie = `__Host-ds_specialty=${id}; Path=/; Secure; SameSite=Lax`;
  }, REMEMBERED_ID);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await assertTheme(page, name, theme);
  if (viewport === "desktop") {
    await page
      .getByTestId("shell-nav-desktop")
      .getByRole("link", { name: "Моя лента" })
      .click();
  } else {
    await page.getByTestId("shell-mobile-menu").locator("summary").click();
    await page
      .getByTestId("shell-nav-mobile")
      .getByRole("link", { name: "Моя лента" })
      .click();
  }
  await page.waitForURL(`**${FEED_PATH}`);
  await page.locator('[data-surface="specialty-feed"]').waitFor();
  verdict(
    new URL(page.url()).pathname === FEED_PATH,
    `${name}: «Моя лента» lands on ${FEED_PATH}`,
  );
  // The ≡ menu is shown open over the feed, so the item is in frame (the
  // shell layout persists across the navigation, so it may still be open).
  if (
    viewport === "mobile" &&
    !(await page.getByTestId("shell-nav-mobile").isVisible())
  ) {
    await page.getByTestId("shell-mobile-menu").locator("summary").click();
    await page.getByTestId("shell-nav-mobile").waitFor();
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

/** Nothing chosen: «Моя лента» opens the home specialty catalog in frame. */
async function shootNoChoice(browser) {
  const name = "interactions-no-choice-desktop";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/events`, { waitUntil: "networkidle" });
  await page
    .getByTestId("shell-nav-desktop")
    .getByRole("link", { name: "Моя лента" })
    .click();
  await page.waitForURL("**/#specialties");
  const inView = await page
    .locator("#specialties")
    .evaluate((el) => el.getBoundingClientRect().top < window.innerHeight);
  verdict(inView, `${name}: lands on /#specialties with the catalog in view`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

/** A home-catalog choice opens that specialty's feed. */
async function shootHomeChoice(browser) {
  const name = "interactions-home-choice-desktop";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page
    .getByTestId("specialty-catalog")
    .getByRole("button", { name: "Кардиология", exact: true })
    .click();
  await page.waitForURL("**/feed/kardiologiya");
  await page.locator('[data-surface="specialty-feed"]').waitFor();
  verdict(true, `${name}: choosing «Кардиология» opens /feed/kardiologiya`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

const browser = await chromium.launch({
  args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`],
});
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootMyFeed(browser, { viewport, theme });
  }
}
await shootNoChoice(browser);
await shootHomeChoice(browser);
await browser.close();

for (const viewport of ["desktop", "mobile"]) {
  const light = statSync(`${OUT}/${viewport}-light.png`).size;
  const dark = statSync(`${OUT}/${viewport}-dark.png`).size;
  verdict(light !== dark, `${viewport}: light (${light}B) !== dark (${dark}B)`);
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== ${results.length - failed.length}/${results.length} checks passed ===`,
);
for (const f of failed) console.log(`FAILED: ${f.line}`);
if (failed.length > 0) process.exitCode = 1;
