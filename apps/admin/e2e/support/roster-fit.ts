import { expect, type Locator, type Page } from "@playwright/test";

/** The desktop frames the roster's column shares are set for. */
export const ROSTER_DESKTOP_WIDTHS = [1440, 1280] as const;

/**
 * 044 EARS-22/EARS-37 — the roster grid at a desktop frame (#2316): every header,
 * its sort arrow included, sits on ONE line, and every registration date-time is
 * shown whole (no ellipsis engaged). The ФИО cell is the one allowed to wrap.
 */
export async function expectRosterFits(
  page: Page,
  table: Locator,
): Promise<void> {
  for (const width of ROSTER_DESKTOP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const headers = await table.locator("thead th").evaluateAll((cells) =>
      cells.map((cell) => {
        const box = cell.querySelector("button") ?? cell;
        // One line = every text fragment of the title shares a top edge.
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const rects: DOMRect[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(
            ...[...range.getClientRects()].filter((rect) => rect.width > 0),
          );
        }
        const tops = new Set(rects.map((rect) => Math.round(rect.top)));
        const arrow = box.querySelector("svg")?.getBoundingClientRect();
        const line = rects[0];
        return {
          header: box.textContent ?? "",
          lines: tops.size,
          // The arrow sits beside the title, on the same line, never under it.
          arrowBeside:
            !arrow || !line
              ? true
              : arrow.top < line.bottom && arrow.bottom > line.top,
        };
      }),
    );
    for (const { header, lines, arrowBeside } of headers) {
      expect(lines, `«${header}» on one line at ${width}px`).toBe(1);
      expect(
        arrowBeside,
        `«${header}» arrow beside its title at ${width}px`,
      ).toBe(true);
    }
    const cutDates = await table
      .locator("td:has([data-testid='roster-cell-registeredAt'])")
      .evaluateAll((cells) =>
        cells
          .filter(
            (cell) =>
              (cell as HTMLElement).offsetParent !== null &&
              cell.scrollWidth > cell.clientWidth,
          )
          .map((cell) => cell.textContent),
      );
    expect(cutDates, `registration dates cut at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
