/**
 * One-off UI-evidence capture for #3511 (048 EARS-2 — the material body
 * renderer `RichTextContent` and editor `RichTextEditor`). Not a test — a
 * screenshot driver for the PR's `ui-render-*` / `ui-interactions` markers, run
 * by hand against a live showcase. Kept out of `e2e/*.spec.ts` so Playwright
 * never picks it up.
 *
 *   E2E_SHOWCASE_URL=http://127.0.0.1:3511 node e2e/ui-evidence-3511.mjs <outDir>
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_SHOWCASE_URL ?? "http://127.0.0.1:3511";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function open(browser, { route, viewport, theme }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
    locale: "ru-RU",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  // The catalogue re-themes by the `.dark` class on <html>, not by
  // `prefers-color-scheme` (the #1966 capture note).
  await page
    .locator("html")
    .evaluate(
      (html, isDark) => html.classList.toggle("dark", isDark),
      theme === "dark",
    );
  return { ctx, page };
}

const section = (page, name) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .first();

const browser = await chromium.launch();

// The four render shots: the «Текст материала» section — every allowlisted node
// of the canvas «текст» block rendered by `RichTextContent`.
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await open(browser, {
      route: "/blocks",
      viewport,
      theme,
    });
    const s = section(page, "Текст материала");
    await s.scrollIntoViewIfNeeded();
    await s.screenshot({ path: `${OUT}/${viewport}-${theme}.png` });
    await ctx.close();
    console.log(`captured ${viewport}-${theme}.png`);
  }
}

// The interaction: a fragment with a paragraph, an image and a table pasted
// into the empty editor (the real ProseMirror paste path); the editor keeps the
// paragraph and drops the rest. Then bold applied from the toolbar.
{
  const { ctx, page } = await open(browser, {
    route: "/primitives",
    viewport: "desktop",
    theme: "light",
  });
  const s = section(page, "RichTextEditor");
  await s.scrollIntoViewIfNeeded();
  const surface = page
    .getByRole("textbox", { name: "RichTextEditor sample (empty)" })
    .first();
  await surface.waitFor();
  await page.waitForTimeout(1500);
  await surface.evaluate((el) => {
    el.editor.view.pasteHTML(
      '<p>Вставленный абзац из Word <span style="color:red;font-family:Comic Sans MS">с цветом и шрифтом</span></p>' +
        '<img src="https://example.org/a.png" alt="картинка">' +
        "<table><tr><td>ячейка таблицы</td></tr></table>",
      new el.ownerDocument.defaultView.Event("paste"),
    );
  });
  const html = await surface.evaluate((el) => el.innerHTML);
  console.log(
    `after paste: img=${html.includes("<img")} table=${html.includes("<table")} paragraph=${html.includes("Вставленный абзац")}`,
  );
  await page.waitForTimeout(400);
  await s.screenshot({ path: `${OUT}/interactions-paste-stripped.png` });
  await ctx.close();
  console.log("captured interactions-paste-stripped.png");
}

await browser.close();
