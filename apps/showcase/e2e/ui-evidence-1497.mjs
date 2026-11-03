/**
 * One-off UI-evidence capture for #1497 (@ds/design-system DoctorContentCard).
 * Not a test — a screenshot driver for the PR's `ui-render-*` / `ui-interactions`
 * markers, run by hand against a live showcase production build. Kept out of
 * `e2e/*.spec.ts` so Playwright never picks it up.
 *
 *   E2E_SHOWCASE_URL=http://localhost:3497 node e2e/ui-evidence-1497.mjs <outDir>
 *
 * Every shot is taken with transitions settled: the context runs with
 * `reducedMotion: 'reduce'` (the frame carries `motion-reduce:transition-none`)
 * and the driver waits for running animations to finish after the theme toggle,
 * then asserts the frame's computed `box-shadow` before capturing — a capture
 * taken mid-transition (the theme flip or the hover press) is refused.
 */

// The page.evaluate callbacks run in the browser, not in Node.
/* global window, document, getComputedStyle */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_SHOWCASE_URL ?? "http://localhost:3497";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  1440: { width: 1440, height: 1024 },
  390: { width: 390, height: 844 },
};
// Canvas elevation ink: light #114D9E, dark #6BB1F7 (`--color-elevation`).
const ELEVATION = { light: "rgb(17, 77, 158)", dark: "rgb(107, 177, 247)" };
const SPECIMEN = '[data-testid="content-card-showcase"]';
let failures = 0;

// An element screenshot clips at the border box, which drops the 6px offset
// shadow — the evidence under review. Shoot the box plus a margin instead.
async function shoot(page, locator, path, pad = 16) {
  // boundingBox() is viewport-relative; a full-page clip takes page coordinates.
  const b = await locator.boundingBox();
  const { sx, sy } = await page.evaluate(() => ({
    sx: window.scrollX,
    sy: window.scrollY,
  }));
  await page.screenshot({
    path,
    fullPage: true,
    clip: {
      x: Math.max(0, b.x + sx - pad),
      y: Math.max(0, b.y + sy - pad),
      width: b.width + pad * 2,
      height: b.height + pad * 2,
    },
  });
}

function fail(msg) {
  failures += 1;
  console.error(`FAIL ${msg}`);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished));
  });
}

async function shadows(page) {
  return page.$$eval(`${SPECIMEN} [data-content-card]`, (els) =>
    els.map((e) => ({
      state: e.dataset.state,
      shadow: getComputedStyle(e).boxShadow,
    })),
  );
}

async function open(browser, width, theme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[width],
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/blocks`, { waitUntil: "networkidle" });
  // The catalogue re-themes by the `.dark` class on <html> (the #515 toggle).
  await page
    .locator("html")
    .evaluate(
      (html, dark) => html.classList.toggle("dark", dark),
      theme === "dark",
    );
  await settle(page);
  return { ctx, page };
}

function checkFrames(list, width, theme, label) {
  for (const { state, shadow } of list) {
    const flat = !shadow.includes("6px 6px");
    if (width === 390 || state === "soon") {
      if (!flat)
        fail(`${label} ${state}: expected no offset shadow, got ${shadow}`);
    } else if (!shadow.includes(`${ELEVATION[theme]} 6px 6px 0px 0px`)) {
      fail(
        `${label} ${state}: expected ${ELEVATION[theme]} 6px 6px, got ${shadow}`,
      );
    }
  }
  const rest = list.find((f) => f.state === "normal");
  console.log(`${label} rest box-shadow: ${rest?.shadow.split(", rgb").pop()}`);
}

const browser = await chromium.launch();

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await open(browser, width, theme);
    const suffix = theme === "dark" ? "-dark" : "";
    const label = `${width}${suffix}`;
    checkFrames(await shadows(page), width, theme, label);
    const specimen = page.locator(SPECIMEN);
    await specimen.scrollIntoViewIfNeeded();
    await shoot(page, specimen, `${OUT}/head-content-card-${label}.png`);

    if (width === 1440) {
      const card = specimen.locator("[data-content-card]").first();
      // Rest: the first card alone, shadow asserted above.
      await shoot(
        page,
        card,
        `${OUT}/head-content-card-1440-rest${suffix}.png`,
      );

      // Hover: real pointer hover; settled press = shadow-md (4px) + 2px translate.
      await card.hover();
      await settle(page);
      const hovered = await card.evaluate((e) => getComputedStyle(e).boxShadow);
      if (!hovered.includes(`${ELEVATION[theme]} 4px 4px 0px 0px`)) {
        fail(
          `${label} hover: expected ${ELEVATION[theme]} 4px 4px, got ${hovered}`,
        );
      }
      console.log(`${label} hover box-shadow: ${hovered.split(", rgb").pop()}`);
      await shoot(
        page,
        card,
        `${OUT}/head-content-card-1440-hover${suffix}.png`,
      );

      // Focus: move the pointer away, Tab onto the card's one link.
      await page.mouse.move(0, 0);
      const link = card.getByRole("link");
      // Land on the link, step back one stop, then a real Tab forward onto it
      // (keyboard modality, so `:focus-visible` holds).
      await link.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const focused = await link.evaluate((a) => a.matches(":focus-visible"));
      if (!focused)
        fail(
          `${label} focus: Tab did not land a focus-visible ring on the card link`,
        );
      await settle(page);
      await shoot(
        page,
        card,
        `${OUT}/head-content-card-1440-focus${suffix}.png`,
      );
    }
    await ctx.close();
  }
}

await browser.close();
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("ok");
