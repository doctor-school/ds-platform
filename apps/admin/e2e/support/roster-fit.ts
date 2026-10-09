import { expect, type Locator, type Page } from "@playwright/test";

/** The desktop frames the roster's column shares are set for. */
export const ROSTER_DESKTOP_WIDTHS = [1440, 1280] as const;

/**
 * 044 EARS-22/EARS-37 — the roster grid at a desktop frame (#2316): every header
 * title sits on ONE line beside its sort arrow — the presence header with a day
 * chosen is the intended two-line one, «Присутствие» over «день ДД.ММ» (S1-3) — and every registration date-time is
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
        // Each text fragment (the title, and a day header's «день ДД.ММ»
        // qualifier) must sit on ONE line: all its client rects share a top.
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const fragments: DOMRect[][] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()].filter(
            (rect) => rect.width > 0,
          );
          if (rects.length > 0) fragments.push(rects);
        }
        const wrapped = fragments.some(
          (rects) => new Set(rects.map((rect) => Math.round(rect.top))).size > 1,
        );
        const all = fragments.flat();
        const top = Math.min(...all.map((rect) => rect.top));
        const bottom = Math.max(...all.map((rect) => rect.bottom));
        const arrow = box.querySelector("svg")?.getBoundingClientRect();
        return {
          header: box.getAttribute("aria-label") ?? box.textContent ?? "",
          wrapped,
          // Title lines: 1, or 2 for a header with its qualifier underneath.
          lines: new Set(all.map((rect) => Math.round(rect.top))).size,
          fragments: fragments.length,
          // The arrow sits beside the title block, never under it.
          arrowBeside:
            !arrow || all.length === 0
              ? true
              : arrow.top < bottom && arrow.bottom > top,
        };
      }),
    );
    for (const { header, wrapped, lines, fragments, arrowBeside } of headers) {
      expect(wrapped, `«${header}» wraps at ${width}px`).toBe(false);
      expect(lines, `«${header}» line count at ${width}px`).toBe(
        fragments,
      );
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
