/**
 * One-off UI-evidence capture for #1968 (028 EARS-2,3,4,5 — the Academy host's
 * «Документы и контакты» index and its document route, both host projections of
 * the shared `<LegalDocument>` / `<LegalDocumentList>` / `<ContactChip>` blocks).
 * Not a test — a screenshot driver for the PR's `ui-render-*` / `ui-interactions`
 * markers, kept out of `e2e/*.spec.ts` so Playwright never collects it.
 * Mirrors `apps/portal/e2e/ui-evidence-1934.mjs`.
 *
 * Run against the built Academy stand (see `~/.ds-platform/1968-logs/boot-portal.sh`):
 *
 *   E2E_PORTAL_URL=http://localhost:3501 \
 *     node apps/portal/e2e/ui-evidence-1968.mjs .github/ui-evidence/1968
 *
 * The portal theme is CLASS-based (`apps/portal/lib/theme.ts`: the `ds-theme`
 * localStorage choice wins, the inline `THEME_INIT_SCRIPT` writes `.dark` on
 * `<html>` before first paint), so the OS-level `colorScheme` context option
 * alone would not be authoritative. Both halves are seeded here and the rendered
 * theme is ASSERTED before every shot.
 */

/* global localStorage, document */

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";

const PORTAL = process.env.E2E_PORTAL_URL ?? "http://localhost:3501";
const OUT = process.argv[2] ?? ".github/ui-evidence/1968";
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

/** The theme actually took — asserted rather than trusted. */
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

async function shoot(page, name, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`captured ${name}.png`);
}

/** The documents index, four viewport × theme combinations. */
async function shootIndex(browser, { viewport, theme }) {
  const name = `${viewport}-${theme}`;
  const ctx = await context(browser, viewport, theme);
  const page = await ctx.newPage();
  await page.goto(`${PORTAL}/documents`, { waitUntil: "networkidle" });
  await page.getByTestId("documents-list").waitFor();
  await page.getByTestId("documents-requisites").waitFor();
  await assertTheme(page, name, theme);
  await shoot(page, name);
  await ctx.close();
}

/** The document route at desktop width — the ToC renders as a sticky aside. */
async function shootDocumentDesktop(browser) {
  const name = "interactions-document-desktop";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  await page.goto(`${PORTAL}/documents/privacy-policy`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("legal-document-body").waitFor();
  await page.getByTestId("legal-document-toc-aside").waitFor();
  await assertTheme(page, name, "light");
  await shoot(page, name, false);
  await ctx.close();
}

/** The driven interaction state: the mobile ToC `<details>` opened by a click. */
async function shootTocMobileOpen(browser) {
  const name = "interactions-toc-mobile-open";
  const ctx = await context(browser, "mobile", "light");
  const page = await ctx.newPage();
  await page.goto(`${PORTAL}/documents/privacy-policy`, {
    waitUntil: "networkidle",
  });
  const toc = page.getByTestId("legal-document-toc-collapsed");
  await toc.waitFor();
  await toc.locator("summary").click();
  await toc.evaluate((el) => {
    if (!el.open) throw new Error("ui-evidence: the ToC did not open on click");
  });
  await assertTheme(page, name, "light");
  await shoot(page, name, false);
  await ctx.close();
}

/** The unresolved slug — the not-found state rendered INSIDE the 008 shell. */
async function shootNotFound(browser) {
  const name = "interactions-not-found";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  const response = await page.goto(`${PORTAL}/documents/no-such-doc`, {
    waitUntil: "networkidle",
  });
  if (response?.status() !== 404) {
    throw new Error(
      `ui-evidence: expected HTTP 404 for an unresolved slug, got ${response?.status()}`,
    );
  }
  await page.getByTestId("legal-document").waitFor();
  await assertTheme(page, name, "light");
  await shoot(page, name, false);
  await ctx.close();
}

const browser = await chromium.launch();

for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootIndex(browser, { viewport, theme });
  }
}
await shootDocumentDesktop(browser);
await shootTocMobileOpen(browser);
await shootNotFound(browser);

await browser.close();

/**
 * Light ≠ dark is proved by byte size, not by trust: an identical pair would mean
 * the theme seed silently failed and the evidence would be worthless.
 */
for (const viewport of ["desktop", "mobile"]) {
  const light = statSync(`${OUT}/${viewport}-light.png`).size;
  const dark = statSync(`${OUT}/${viewport}-dark.png`).size;
  if (light === dark) {
    throw new Error(
      `ui-evidence: ${viewport}-light.png and ${viewport}-dark.png are byte-identical — the theme did not switch`,
    );
  }
  console.log(`${viewport}: light ${light}B ≠ dark ${dark}B`);
}
