/**
 * One-off UI-evidence capture for #1663 (003 EARS-38, the show-password toggle).
 * Not a test — a screenshot driver for the PR's `ui-render-*` / `ui-interactions`
 * markers. Kept out of `e2e/*.spec.ts` so Playwright never collects it as a spec.
 * Mirrors `apps/doctor/e2e/ui-evidence-1541.mjs`.
 *
 * It shoots BOTH storefronts, because the point of the slice is that one shared
 * primitive serves both: the doctor `/register` matrix plus a portal `/login`
 * revealed frame.
 *
 *   pnpm --filter @ds/doctor build && pnpm --filter @ds/portal build
 *   pnpm --filter @ds/doctor exec next start -p 3210
 *   pnpm --filter @ds/portal exec next start -p 3110
 *   E2E_DOCTOR_URL=http://127.0.0.1:3210 E2E_PORTAL_URL=http://127.0.0.1:3110 \
 *     node apps/doctor/e2e/ui-evidence-1663.mjs .github/ui-evidence/1663
 */

/* global localStorage, document */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const DOCTOR = process.env.E2E_DOCTOR_URL ?? "http://127.0.0.1:3210";
const PORTAL = process.env.E2E_PORTAL_URL ?? "http://127.0.0.1:3110";
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

const PASSWORD = "correct horse 42";

async function open(browser, { viewport, theme }) {
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

async function shootDoctor(browser, { name, viewport, theme, revealed }) {
  const { ctx, page } = await open(browser, { viewport, theme });
  await page.goto(`${DOCTOR}/register`, { waitUntil: "networkidle" });
  const input = page.getByTestId("register-password");
  await input.waitFor();
  await input.fill(PASSWORD);
  await assertTheme(page, name, theme);
  if (revealed) await page.getByTestId("register-password-reveal").click();
  await input.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

async function shootPortalLoginRevealed(browser) {
  const name = "interactions-portal-login-revealed";
  const { ctx, page } = await open(browser, {
    viewport: "desktop",
    theme: "light",
  });
  await page.goto(`${PORTAL}/login`, { waitUntil: "networkidle" });
  const input = page.locator("input[name='password']");
  await input.waitFor();
  await input.fill(PASSWORD);
  await page.getByRole("button", { name: "Показать пароль" }).click();
  await input.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

// The four resting frames: the field MASKED, the affordance visible, in both
// viewports and both themes.
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootDoctor(browser, {
      name: `${viewport}-${theme}`,
      viewport,
      theme,
    });
  }
}

// The interaction the clause is about: the value rendered in plain text with the
// control flipped to «Скрыть».
await shootDoctor(browser, {
  name: "interactions-revealed",
  viewport: "desktop",
  theme: "light",
  revealed: true,
});

await shootPortalLoginRevealed(browser);

await browser.close();
