import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  applyAllowlist,
  diffStructures,
  extractCanvasStructure,
  formatStructure,
  type AllowlistEntry,
  type CanvasInput,
  type RegionSpec,
  type RegionStructure,
  type StructureItem,
} from "./canvas-structure.js";
import { waitForClientReady } from "./page-ready.js";

/**
 * #3682 — the APP half of the structural canvas-parity check: read the same
 * semantic tree `./canvas-structure.ts` extracts from a canvas, but from the
 * rendered page, and compare the two.
 *
 * bar  = the region's interactive elements visible with the menu closed;
 * menu = the ones that BECOME visible once the `≡` toggle is opened.
 * Both in VISUAL order — rows top to bottom, left to right inside a row — so a
 * control that sits on its own row by CSS order (the mobile search) is read
 * where the user sees it, which is also the canvas's document order.
 */

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

/** A vendored canvas by file name, e.g. `ds-shell.dc.html`. */
export function canvasPath(name: string): string {
  return resolve(REPO, "design-source", name);
}

const ALLOWLIST = JSON.parse(
  readFileSync(new URL("./canvas-structure-allowlist.json", import.meta.url), "utf8"),
) as { entries: AllowlistEntry[] };

interface Seen extends StructureItem {
  index: number;
  top: number;
  left: number;
  height: number;
}

/** The visible interactive elements under `root`, with their boxes. */
async function visibleItems(page: Page, root: string): Promise<Seen[]> {
  return page.evaluate((rootSelector) => {
    const KIND: Record<string, string> = {
      A: "link",
      BUTTON: "button",
      INPUT: "input",
      SUMMARY: "summary",
    };
    const region = document.querySelector(rootSelector);
    if (!region) throw new Error(`no region ${rootSelector}`);
    const collapse = (t: string) => t.replace(/\s+/g, " ").trim();
    const all = [...region.querySelectorAll("a, button, input, summary")];
    return all.flatMap((el, index) => {
      const box = el.getBoundingClientRect();
      const shown =
        el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        box.width > 1 &&
        box.height > 1 &&
        !el.closest('[aria-hidden="true"]');
      if (!shown) return [];
      // Nested interactive content belongs to its outer control.
      if (el.parentElement?.closest("a, button, summary")) return [];
      let label: string | null;
      if (el.tagName === "INPUT") {
        label = collapse(el.getAttribute("placeholder") ?? "") || null;
      } else {
        // Visible text only — an icon/image-only control compares by kind.
        const text = collapse((el as HTMLElement).innerText ?? "");
        label = /[\p{L}\p{N}]/u.test(text) ? text : null;
      }
      return [
        {
          kind: KIND[el.tagName] as StructureItem["kind"],
          label,
          index,
          top: box.top,
          left: box.left,
          height: box.height,
        },
      ];
    });
  }, root);
}

/** Rows by vertical centre (a shared centre within 12px is one row), then left. */
function visualOrder(items: Seen[]): StructureItem[] {
  const byCentre = [...items].sort(
    (a, b) => a.top + a.height / 2 - (b.top + b.height / 2),
  );
  const rows: Seen[][] = [];
  for (const item of byCentre) {
    const row = rows[rows.length - 1];
    const centre = item.top + item.height / 2;
    if (row && Math.abs(row[0]!.top + row[0]!.height / 2 - centre) <= 12) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) =>
    row.sort((a, b) => a.left - b.left).map(({ kind, label }) => ({ kind, label })),
  );
}

export interface RenderedRegion {
  /** The region root, e.g. `[data-testid="storefront-header"]`. */
  root: string;
  /** The menu toggle to open for the `menu` read; absent = no menu read. */
  menuToggle?: string;
}

export async function readRenderedStructure(
  page: Page,
  region: RenderedRegion,
): Promise<RegionStructure> {
  const closed = await visibleItems(page, region.root);
  const toggle = region.menuToggle ? page.locator(region.menuToggle) : null;
  if (!toggle || !(await toggle.isVisible())) {
    return { bar: visualOrder(closed), menu: [] };
  }
  await toggle.click();
  const open = await visibleItems(page, region.root);
  const before = new Set(closed.map((i) => i.index));
  await toggle.click();
  return {
    bar: visualOrder(closed),
    menu: visualOrder(open.filter((i) => !before.has(i.index))),
  };
}

/**
 * Compare a rendered region with the canvas evaluated for `input`; returns the
 * readable failure report, or `null` when the trees match (after the decided
 * deviations in `canvas-structure-allowlist.json`).
 */
export async function canvasStructureMismatch(
  page: Page,
  canvas: string,
  input: CanvasInput,
  rendered: RenderedRegion,
  region?: RegionSpec,
): Promise<string | null> {
  const file = canvasPath(canvas);
  const fromCanvas = extractCanvasStructure(file, input, region);
  const fromApp = await readRenderedStructure(page, rendered);
  const props = input.props ?? {};
  const decided = applyAllowlist(
    ALLOWLIST.entries,
    { canvas: basename(file), props },
    fromCanvas,
    fromApp,
  );
  const lines = diffStructures(decided.canvas, decided.app);
  for (const entry of decided.stale) {
    lines.push(
      `stale allowlist entry (${entry.delta}): ${entry.item.kind} «${entry.item.label ?? "icon"}» — ${entry.source}`,
    );
  }
  if (lines.length === 0) return null;
  return [
    `${canvas} ${JSON.stringify(props)} ≠ rendered ${rendered.root}:`,
    ...lines.map((l) => `  - ${l}`),
    "canvas:",
    formatStructure(fromCanvas).replace(/^/gm, "  "),
    "app:",
    formatStructure(fromApp).replace(/^/gm, "  "),
  ].join("\n");
}

/**
 * The storefront header (`@ds/storefront-shell`, both hosts) against
 * `design-source/ds-shell.dc.html`, guest, at the canvas's two widths: 320 and
 * 390 read the canvas mobile branch, 1440 the desktop one. Guest only — the CI
 * tiers have no session.
 */
export function defineStorefrontHeaderCanvasParity(options: {
  host: "doctor" | "academy";
  /** A route of this storefront that renders without a backend. */
  path: string;
}): void {
  for (const width of [320, 390, 1440]) {
    const mobile = width < 900;
    test.describe(`#3682 header ≡ ds-shell canvas · ${options.host} · guest · ${width}`, () => {
      test.use({ viewport: { width, height: 800 } });
      test(`the rendered header has the canvas structure (bar / ≡ menu)`, async ({
        page,
        context,
      }) => {
        await context.clearCookies();
        await page.goto(options.path);
        await waitForClientReady(page);
        await page.evaluate(() => document.fonts.ready);
        const mismatch = await canvasStructureMismatch(
          page,
          "ds-shell.dc.html",
          { props: { host: options.host, loggedIn: false, mobile } },
          {
            root: '[data-testid="storefront-header"]',
            menuToggle: '[data-testid="shell-mobile-menu"] > summary',
          },
        );
        expect(mismatch, mismatch ?? "").toBeNull();
      });
    });
  }
}
