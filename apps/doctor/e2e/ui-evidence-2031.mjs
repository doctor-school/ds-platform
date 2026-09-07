/**
 * One-off UI-evidence capture for #2031 (017 EARS-2 / EARS-14.1 — the storefront
 * home hero heading fits the 390px viewport). Not a test — a screenshot driver
 * for the PR's `ui-render-*` / `ui-interactions` markers, kept out of
 * `e2e/*.spec.ts` so Playwright never collects it. Mirrors
 * `apps/doctor/e2e/ui-evidence-2015.mjs`.
 *
 * Boot the PRODUCTION standalone build of the branch head (the host builds with
 * `output: "standalone"`; `next start` silently 404s), from the worktree root:
 *
 *   pnpm --filter "@ds/doctor..." build
 *   cp -r apps/doctor/.next/static apps/doctor/.next/standalone/apps/doctor/.next/static
 *   cp -r apps/doctor/public       apps/doctor/.next/standalone/apps/doctor/public
 *   (cd apps/doctor/.next/standalone && PORT=3431 HOSTNAME=0.0.0.0 node apps/doctor/server.js)
 *
 *   E2E_DOCTOR_URL=http://localhost:3431 \
 *     node apps/doctor/e2e/ui-evidence-2031.mjs .github/ui-evidence/2031
 *
 * Port used for the captured evidence: 3431. The hero copy is server markup
 * independent of the statistics read (017 EARS-2), so the heading under
 * evidence renders with or without an api behind `API_PROXY_TARGET`; the
 * counters band below it shows whatever state that read resolves to.
 *
 * `localhost`, never `127.0.0.1`: Next answers 403 to an unlisted origin, the
 * page never hydrates and the driven theme toggle silently does nothing.
 */

/* global localStorage, document, getComputedStyle */
// The identifiers above are referenced only inside `page.evaluate` callbacks,
// which run in the BROWSER, not in this Node process.

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";

const BASE = process.env.E2E_DOCTOR_URL ?? "http://localhost:3431";
const OUT = process.argv[2] ?? ".github/ui-evidence/2031";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

// The doctor theme is CLASS-based (`apps/doctor/lib/theme.ts`): `<html class="dark">`
// keyed off `localStorage["ds-theme"]`. A Playwright `colorScheme` is a no-op
// here, so the choice is seeded BEFORE navigation and the rendered theme is
// ASSERTED before every shot rather than trusted.
const THEME_STORAGE_KEY = "ds-theme";

const HERO = '[data-testid="storefront-hero"]';
const HEADLINE = "Doctor.School — бесплатное образование для врачей";

/** The canvas tiers (`clamp(34px, 5.6vw, 60px)`) mapped onto the type tokens. */
const EXPECTED_FONT_SIZE = { desktop: "60px", mobile: "40px" };

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
    throw new Error(
      `${name}: expected the ${theme} theme, got ${rendersDark ? "dark" : "light"}`,
    );
  }
}

/** The heading's fit + the document's horizontal overflow, measured in-page. */
async function measure(page) {
  return page.evaluate((headline) => {
    const h1 = Array.from(document.querySelectorAll("h1")).find(
      (el) => (el.textContent ?? "").trim() === headline,
    );
    if (!h1) throw new Error("ui-evidence: the hero h1 is not on the page");
    const root = document.documentElement;
    return {
      fontSize: getComputedStyle(h1).fontSize,
      headingOverrun: h1.scrollWidth - h1.clientWidth,
      pageOverrun: root.scrollWidth - root.clientWidth,
    };
  }, HEADLINE);
}

/** The full `/` page with the hero in frame, one shot per viewport × theme. */
async function shootHome(browser, { viewport, theme }) {
  const name = `${viewport}-${theme}`;
  const ctx = await context(browser, viewport, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator(HERO).waitFor();
  await assertTheme(page, name, theme);

  const m = await measure(page);
  verdict(
    m.fontSize === EXPECTED_FONT_SIZE[viewport],
    `${name}: heading font-size ${EXPECTED_FONT_SIZE[viewport]} (got ${m.fontSize})`,
  );
  verdict(
    m.headingOverrun <= 0,
    `${name}: heading fits its content box (overrun ${m.headingOverrun}px)`,
  );
  verdict(
    m.pageOverrun <= 1,
    `${name}: no horizontal page overflow (overrun ${m.pageOverrun}px)`,
  );

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

/**
 * The driven interaction: the header theme toggle re-renders the hero band on
 * the phone; the heading must still fit after the swap, not only on first paint.
 */
async function shootThemeToggleMobile(browser) {
  const name = "interactions-theme-toggle-mobile";
  const ctx = await context(browser, "mobile", "light");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator(HERO).waitFor();
  await assertTheme(page, name, "light");

  const toggle = page.getByTestId("theme-toggle");
  await toggle.click();
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  await assertTheme(page, name, "dark");
  const pressed = await toggle.getAttribute("aria-pressed");
  verdict(
    pressed === "true",
    `theme toggle reports aria-pressed=true (got ${pressed})`,
  );

  const m = await measure(page);
  verdict(
    m.headingOverrun <= 0 && m.pageOverrun <= 1,
    `after the live theme swap the heading still fits (heading ${m.headingOverrun}px, page ${m.pageOverrun}px)`,
  );

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

const browser = await chromium.launch();
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootHome(browser, { viewport, theme });
  }
}
await shootThemeToggleMobile(browser);
await browser.close();

// Light !== dark is proved by byte size, not by trust: an identical pair would
// mean the theme seed silently failed and the evidence would be worthless.
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
