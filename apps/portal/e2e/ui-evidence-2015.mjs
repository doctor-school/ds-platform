/**
 * One-off UI-evidence capture for #2015 (028 EARS-4 — the Academy host's
 * «Сообщества и соцсети» chip row: Telegram → ВКонтакте → RuTube). Not a test —
 * a screenshot driver for the PR's `ui-render-academy-*` / `ui-interactions-academy`
 * markers, kept out of `e2e/*.spec.ts` so Playwright never collects it. Mirrors
 * `apps/portal/e2e/ui-evidence-1968.mjs`.
 *
 * Boot the PRODUCTION standalone build of the branch head (the portal builds with
 * `output: "standalone"`; `next start` silently 404s), from the worktree root:
 *
 *   API_PROXY_TARGET=http://localhost:3500 pnpm --filter "@ds/portal..." build
 *   cp -r apps/portal/.next/static apps/portal/.next/standalone/apps/portal/.next/static
 *   cp -r apps/portal/public       apps/portal/.next/standalone/apps/portal/public
 *   (cd apps/portal/.next/standalone && PORT=3501 HOSTNAME=0.0.0.0 \
 *      API_PROXY_TARGET=http://localhost:3500 node apps/portal/server.js)
 *
 *   E2E_PORTAL_URL=http://localhost:3501 \
 *     node apps/portal/e2e/ui-evidence-2015.mjs .github/ui-evidence/2015/academy
 *
 * Ports used for the captured evidence: portal 3501, api target 3500. `/documents`
 * reads `@ds/legal-content` from the filesystem and renders the contacts card
 * with no api process listening, so none was started.
 *
 * `localhost`, never `127.0.0.1`: Next answers 403 to an unlisted origin and the
 * page never hydrates.
 */

/* global localStorage, document */

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";

const PORTAL = process.env.E2E_PORTAL_URL ?? "http://localhost:3501";
const OUT = process.argv[2] ?? ".github/ui-evidence/2015/academy";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

// The portal theme is CLASS-based (`apps/portal/lib/theme.ts`): the `ds-theme`
// localStorage choice wins and the inline init script writes `.dark` on `<html>`
// before first paint, so the OS-level `colorScheme` alone is not authoritative.
// Both halves are seeded and the rendered theme is ASSERTED before every shot.
const THEME_STORAGE_KEY = "ds-theme";

/** The roster this evidence exists to prove, in DOM order. */
const EXPECTED_CHANNELS = [
  { label: "Telegram", href: "https://t.me/DoctorSchool" },
  { label: "ВКонтакте", href: "https://vk.ru/doctor.school" },
  { label: "RuTube", href: "https://rutube.ru/channel/33533508/" },
];

const CHANNELS = '[data-testid="documents-contacts-channels"]';

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
  await page.goto(`${PORTAL}/documents`, { waitUntil: "networkidle" });
  await page.locator(CHANNELS).waitFor();
  await page.getByTestId("documents-requisites").waitFor();
  await assertTheme(page, name, theme);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

/** The roster assertions + the driven hover on the RuTube chip. */
async function shootChipsHover(browser) {
  const name = "interactions-chips-hover-academy";
  const ctx = await context(browser, "desktop", "light");
  const page = await ctx.newPage();
  await page.goto(`${PORTAL}/documents`, { waitUntil: "networkidle" });
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
