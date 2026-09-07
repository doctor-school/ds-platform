/**
 * One-off UI-evidence capture for #1966 (028 EARS-7,11,14 — the shared legal
 * document reading surface). Not a test — a screenshot driver for the PR's
 * `ui-render-*` / `ui-interactions` markers, run by hand against a live
 * showcase. Kept out of `e2e/*.spec.ts` so Playwright never picks it up.
 *
 *   E2E_SHOWCASE_URL=http://localhost:3331 node e2e/ui-evidence-1966.mjs <outDir>
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

// `localhost`, not `127.0.0.1`: Next 16 dev refuses the asset requests of an
// unlisted dev origin with 403, the page never hydrates, and every "interaction"
// shot silently comes back in the initial state.
const BASE = process.env.E2E_SHOWCASE_URL ?? "http://localhost:3331";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function shoot(browser, { name, viewport, theme, after }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/blocks`, { waitUntil: "networkidle" });
  // The catalogue re-themes by the `.dark` class on <html> (the #515 runtime page
  // toggle), NOT by `prefers-color-scheme` — the context `colorScheme` above only
  // aligns UA form controls. Stamp the class exactly as `a11y-axe.e2e.spec.ts`
  // does, otherwise the "dark" shots come back byte-identical to the light ones.
  await page
    .locator("html")
    .evaluate((html, isDark) => html.classList.toggle("dark", isDark), theme === "dark");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Документ", exact: true }) })
    .first();
  await section.scrollIntoViewIfNeeded();
  if (after) {
    // The catalogue is one large client component; in dev it needs a beat to
    // hydrate before a click reaches React state.
    await page.waitForTimeout(3000);
    await after(page, section);
    await page.waitForTimeout(600);
  }
  await section.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

// The four render shots: the whole «Документ» section — the live render on the
// REAL published privacy policy, the props contract, and the four-state matrix —
// at both breakpoints in both themes. At 1440 (`xl`) the table of contents is the
// sticky left aside; at 390 the SAME entries collapse into the `<details>` list
// above the body (028 V-2, one data source).
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: `${viewport}-${theme}`, viewport, theme });
  }
}

// Interactions: the state toggle driving the live render through the three
// non-normal states, each of which stays INSIDE the document shell.
for (const [name, label] of [
  ["interactions-state-loading", "загрузка"],
  ["interactions-state-error", "ошибка"],
  ["interactions-state-not-found", "не найден"],
]) {
  await shoot(browser, {
    name,
    viewport: "desktop",
    theme: "light",
    after: async (_page, section) => {
      await section.getByRole("button", { name: label, exact: true }).first().click();
    },
  });
}

// The collapsed mobile table of contents opened — the `<details>` disclosure that
// carries the same entries as the `xl` sticky aside.
await shoot(browser, {
  name: "interactions-toc-mobile-open",
  viewport: "mobile",
  theme: "light",
  after: async (_page, section) => {
    await section.locator("details summary").first().click();
  },
});

await browser.close();
