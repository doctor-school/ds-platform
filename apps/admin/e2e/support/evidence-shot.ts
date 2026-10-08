import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Evidence screenshots of an approved non-canvas admin route (the
 * `responsive-web` profile of `tools/lint/ui-parity-lint.ts`): the current
 * state at 1440 and 390, light and dark, as `<name>-<desktop|mobile>-<light|dark>.png`
 * under `E2E_SHOT_DIR`. A no-op when `E2E_SHOT_DIR` is unset, so the specs run
 * the same in CI.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The admin's dark palette is the `.dark` token block on the document root. */
async function setPalette(page: Page, palette: "light" | "dark") {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
  await page.waitForFunction((mode) => {
    const channels = getComputedStyle(document.body).backgroundColor.match(
      /[\d.]+/g,
    );
    if (!channels || channels.length < 3) return false;
    const [r, g, b] = channels.map(Number);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return mode === "dark" ? luminance < 128 : luminance >= 128;
  }, palette);
}

export interface EvidenceShotOptions {
  /**
   * Runs after every width/palette switch, before the shot: a DS `Sheet` swaps
   * between its modal (below lg) and inspector modes on a width change, which
   * remounts its content, so unsaved form input is re-entered and the block in
   * question scrolled into view here.
   */
  prepare?: () => Promise<void>;
  /** `false` for a fixed overlay (a `Sheet`) that a full-page shot would clip. */
  fullPage?: boolean;
}

/** The state at both widths and both palettes; the page is left at its viewport, light. */
export async function evidenceShot(
  page: Page,
  name: string,
  { prepare, fullPage = true }: EvidenceShotOptions = {},
): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  for (const [label, width] of [
    ["desktop", 1440],
    ["mobile", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const palette of ["light", "dark"] as const) {
      await setPalette(page, palette);
      await prepare?.();
      // The controls fade their colours (`transition-colors`): a shot taken
      // mid-fade after a palette or width switch shows washed-out fields.
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name}-${label}-${palette}.png`),
        fullPage,
      });
    }
  }
  await setPalette(page, "light");
  await page.setViewportSize(viewport);
  await prepare?.();
}
