/**
 * One-off UI-evidence capture for #2015 (028 EARS-4 — the doctor storefront's
 * «Сообщества и соцсети» chip row: Telegram → ВКонтакте → RuTube). Not a test —
 * a screenshot driver for the PR's `ui-render-*` / `ui-interactions` markers,
 * kept out of `e2e/*.spec.ts` so Playwright never collects it. Mirrors
 * `apps/doctor/e2e/ui-evidence-1967.mjs`.
 *
 * Boot the PRODUCTION standalone build of the branch head (both hosts build with
 * `output: "standalone"`; `next start` silently 404s), from the worktree root:
 *
 *   pnpm --filter "@ds/doctor..." build
 *   cp -r apps/doctor/.next/static apps/doctor/.next/standalone/apps/doctor/.next/static
 *   cp -r apps/doctor/public       apps/doctor/.next/standalone/apps/doctor/public
 *   (cd apps/doctor/.next/standalone && PORT=3404 HOSTNAME=0.0.0.0 node apps/doctor/server.js)
 *
 *   E2E_DOCTOR_URL=http://localhost:3404 \
 *     node apps/doctor/e2e/ui-evidence-2015.mjs .github/ui-evidence/2015/doctor
 *
 * Port used for the captured evidence: 3404. `/documents` renders `@ds/legal-content`
 * from the filesystem, so no api process is required for this surface.
 *
 * `localhost`, never `127.0.0.1`: Next answers 403 to an unlisted origin, the
 * page never hydrates and every "interaction" shot silently comes back in the
 * initial state.
 */

/* global localStorage, document */
// The identifiers above are referenced only inside `page.evaluate` callbacks,
// which run in the BROWSER, not in this Node process.

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";

const BASE = process.env.E2E_DOCTOR_URL ?? "http://localhost:3404";
const OUT = process.argv[2] ?? ".github/ui-evidence/2015/doctor";
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

/** The roster this evidence exists to prove, in DOM order. */
const EXPECTED_CHANNELS = [
  { label: "Telegram", href: "https://t.me/DoctorSchool" },
  { label: "ВКонтакте", href: "https://vk.ru/doctor.school" },
  { label: "RuTube", href: "https://rutube.ru/channel/33533508/" },
];

const CHANNELS = '[data-testid="documents-channels"]';

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

/** The full `/documents` page with the contacts card in frame. */
async function shootIndex(browser, { viewport, theme }) {
  const name = `${viewport}-${theme}`;
  const ctx = await context(browser, viewport, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/documents`, { waitUntil: "networkidle" });
  await page.locator(CHANNELS).waitFor();
  await page.getByTestId("documents-requisites").waitFor();
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

/** The roster assertions + the driven hover on the RuTube chip. */
async function shootChipsHover(browser) {
  const name = "interactions-chips-hover-doctor";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/documents`, { waitUntil: "networkidle" });
  await page.locator(CHANNELS).waitFor();

  const chips = page.locator(`${CHANNELS} a`);
  const count = await chips.count();
  verdict(
    count === 3,
    `channels container holds exactly three chips (got ${count})`,
  );

  const rendered = await page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(`${selector} a`)).map((a) => ({
        label: (a.textContent ?? "").trim(),
        href: a.getAttribute("href"),
      })),
    CHANNELS,
  );
  const wanted = JSON.stringify(EXPECTED_CHANNELS);
  const got = JSON.stringify(rendered);
  verdict(
    wanted === got,
    `chip labels + hrefs in DOM order: want ${wanted} got ${got}`,
  );

  const deadLinks = await page.evaluate(
    () => Array.from(document.querySelectorAll('a[href="#"]')).length,
  );
  verdict(
    deadLinks === 0,
    `zero dead href="#" anchors on the page (got ${deadLinks})`,
  );

  const youtube = await page.evaluate(() =>
    (document.body.textContent ?? "").includes("YouTube"),
  );
  verdict(
    !youtube,
    `no «YouTube» text anywhere on /documents (found=${youtube})`,
  );

  const rutube = chips.nth(2);
  const rutubeHref = await rutube.getAttribute("href");
  verdict(
    rutubeHref === "https://rutube.ru/channel/33533508/",
    `hovered chip href === https://rutube.ru/channel/33533508/ (got ${rutubeHref})`,
  );

  await rutube.scrollIntoViewIfNeeded();
  await rutube.hover();
  await page.waitForTimeout(300);
  await assertTheme(page, name, "light");
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

const browser = await chromium.launch();
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shootIndex(browser, { viewport, theme });
  }
}
await shootChipsHover(browser);
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
