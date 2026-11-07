import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  applyAllowlist,
  diffStructures,
  formatStructure,
  type AllowlistEntry,
  type RegionStructure,
  type StructureItem,
} from "./canvas-structure.js";
import { openRuntimeCanvas } from "./canvas-runtime.js";
import { waitForClientReady } from "./page-ready.js";

/**
 * #3682 — the structural canvas-parity check: read one semantic tree from the
 * rendered app page and from the canvas, and compare the two. The canvas side
 * is the SAME reader on the canvas as the real Claude Design runtime renders it
 * (`./canvas-runtime.ts`, offline, in the spec's own browser context) — the
 * ds-shell header/footer here (#3793), the page sections in
 * `./rendered-slots.ts` (#3798).
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
  readFileSync(
    new URL("./canvas-structure-allowlist.json", import.meta.url),
    "utf8",
  ),
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
function rowOrder(items: Seen[]): StructureItem[] {
  const byCentre = [...items].sort(
    (a, b) => a.top + a.height / 2 - (b.top + b.height / 2),
  );
  const rows: Seen[][] = [];
  for (const item of byCentre) {
    const row = rows[rows.length - 1];
    const centre = item.top + item.height / 2;
    if (row && Math.abs(row[0]!.top + row[0]!.height / 2 - centre) <= 12)
      row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) =>
    row
      .sort((a, b) => a.left - b.left)
      .map(({ kind, label }) => ({ kind, label })),
  );
}

export interface RenderedRegion {
  /** The region root, e.g. `[data-testid="storefront-header"]`. */
  root: string;
  /** The menu toggle to open for the `menu` read; absent = no menu read. */
  menuToggle?: string;
  /**
   * `visual` (default): rows top to bottom, left to right. `document`: DOM
   * order — for a region of side-by-side columns (the footer grid), whose
   * canvas order is column by column, not row by row.
   */
  order?: "visual" | "document";
}

function documentOrder(items: Seen[]): StructureItem[] {
  return [...items]
    .sort((a, b) => a.index - b.index)
    .map(({ kind, label }) => ({ kind, label }));
}

export async function readRenderedStructure(
  page: Page,
  region: RenderedRegion,
): Promise<RegionStructure> {
  const closed = await visibleItems(page, region.root);
  const ordered = region.order === "document" ? documentOrder : rowOrder;
  const toggle = region.menuToggle ? page.locator(region.menuToggle) : null;
  if (!toggle || !(await toggle.isVisible())) {
    return { bar: ordered(closed), menu: [] };
  }
  await toggle.click();
  const open = await visibleItems(page, region.root);
  // Assumes the ≡ panel is always in the DOM (CSS-toggled), so querySelectorAll
  // indexes stay stable between the closed and open reads.
  const before = new Set(closed.map((i) => i.index));
  await toggle.click();
  return {
    bar: ordered(closed),
    menu: ordered(open.filter((i) => !before.has(i.index))),
  };
}

/** A region of a runtime-rendered canvas page, read like an app region. */
export interface CanvasRegion extends RenderedRegion {
  /** The region's name in `canvas-structure-allowlist.json` (`header`, `footer`). */
  name: string;
  /**
   * Siblings read after `root` and appended to its bar — the ds-shell mobile
   * search band, which the canvas draws right after `<header>`, inside the
   * header region, while the app draws it inside its header element.
   */
  after?: string;
}

/** The canvas side: `canvas` rendered by the real runtime with `props`, read. */
export async function readRuntimeCanvasStructure(
  context: BrowserContext,
  canvas: string,
  props: Record<string, unknown>,
  region: CanvasRegion,
): Promise<RegionStructure> {
  const runtime = await openRuntimeCanvas(context, canvas, { props });
  try {
    const structure = await readRenderedStructure(runtime.page, region);
    if (region.after && (await runtime.page.locator(region.after).count())) {
      const band = await readRenderedStructure(runtime.page, {
        root: region.after,
      });
      structure.bar.push(...band.bar);
    }
    return structure;
  } finally {
    await runtime.close();
  }
}

/**
 * Compare a rendered region with the canvas region rendered by the runtime for
 * `props`; returns the readable failure report, or `null` when the trees match
 * (after the decided deviations in `canvas-structure-allowlist.json`, keyed by
 * `allowlistProps`).
 */
export async function canvasStructureMismatch(
  page: Page,
  canvas: string,
  props: Record<string, unknown>,
  allowlistProps: Record<string, unknown>,
  canvasRegion: CanvasRegion,
  rendered: RenderedRegion,
): Promise<string | null> {
  const fromCanvas = await readRuntimeCanvasStructure(
    page.context(),
    canvas,
    props,
    canvasRegion,
  );
  const fromApp = await readRenderedStructure(page, rendered);
  const decided = applyAllowlist(
    ALLOWLIST.entries,
    {
      canvas: basename(canvas),
      props: allowlistProps,
      region: canvasRegion.name,
    },
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

/** The storefront regions checked against `design-source/ds-shell.dc.html`. */
const SHELL_HEADER = 'header[data-screen-label="ds-shell · шапка"]';
const STOREFRONT_REGIONS = {
  header: {
    canvas: {
      name: "header",
      root: SHELL_HEADER,
      menuToggle: `${SHELL_HEADER} details > summary`,
      after: `${SHELL_HEADER} + div`,
    },
    rendered: {
      root: '[data-testid="storefront-header"]',
      menuToggle: '[data-testid="shell-mobile-menu"] > summary',
    },
    issue: "#3682",
    title: " (bar / ≡ menu)",
  },
  footer: {
    canvas: {
      name: "footer",
      root: 'footer[data-screen-label="ds-shell · футер"]',
      order: "document",
    },
    rendered: { root: '[data-testid="storefront-footer"]', order: "document" },
    issue: "#3727",
    title: "",
  },
} satisfies Record<
  string,
  {
    canvas: CanvasRegion;
    rendered: RenderedRegion;
    issue: string;
    title: string;
  }
>;

export interface StorefrontCanvasParityOptions {
  host: "doctor" | "academy";
  /** A route of this storefront that renders (with no backend on a guest tier). */
  path: string;
  /**
   * Signs the page in with the tier's own session setup before the read; the
   * canvas is then evaluated with `loggedIn: true`. Absent = guest (cookies
   * cleared).
   */
  signIn?: (page: Page) => Promise<void>;
}

function defineStorefrontCanvasParity(
  region: keyof typeof STOREFRONT_REGIONS,
  options: StorefrontCanvasParityOptions,
): void {
  const { canvas, rendered, issue, title } = STOREFRONT_REGIONS[region];
  const loggedIn = !!options.signIn;
  const who = loggedIn ? "signed-in" : "guest";
  for (const width of [320, 390, 1440]) {
    const mobile = width < 900;
    test.describe(`${loggedIn ? "#3727" : issue} ${region} ≡ ds-shell canvas · ${options.host} · ${who} · ${width}`, () => {
      test.use({ viewport: { width, height: 800 } });
      test(`the rendered ${region} has the canvas structure${title}`, async ({
        page,
        context,
      }) => {
        if (options.signIn) await options.signIn(page);
        else await context.clearCookies();
        await page.goto(options.path);
        await waitForClientReady(page);
        // The cluster resolves its branch after hydration on the Academy host
        // (a client profile read); read only once it is the signed-in one.
        await page
          .locator(
            `[data-testid="shell-auth-cluster"][data-cluster="${loggedIn ? "doctor" : "guest"}"]`,
          )
          .waitFor({ state: "attached" });
        await page.evaluate(() => document.fonts.ready);
        // `embedded: true` = the shell as a page draws it: ≡ starts closed
        // (standalone ds-shell opens it at 390) and the editor panel is off.
        const mismatch = await canvasStructureMismatch(
          page,
          "ds-shell.dc.html",
          { host: options.host, loggedIn, embedded: true },
          { host: options.host, loggedIn, mobile },
          canvas,
          rendered,
        );
        expect(mismatch, mismatch ?? "").toBeNull();
      });
    });
  }
}

/**
 * The storefront header (`@ds/storefront-shell`, both hosts) against
 * `design-source/ds-shell.dc.html` at the canvas's two widths: 320 and 390 read
 * the canvas mobile branch, 1440 the desktop one; bar and `≡` menu. Guest, or
 * signed in (`loggedIn: true`) when `signIn` is given.
 */
export function defineStorefrontHeaderCanvasParity(
  options: StorefrontCanvasParityOptions,
): void {
  defineStorefrontCanvasParity("header", options);
}

/**
 * #3727 — the storefront footer against the canvas `ds-shell · футер` artboard
 * at 320 / 390 / 1440: its links in document (column) order; the decorative
 * giant wordmark is `aria-hidden` and carries none.
 */
export function defineStorefrontFooterCanvasParity(
  options: StorefrontCanvasParityOptions,
): void {
  defineStorefrontCanvasParity("footer", options);
}

/**
 * #3793 RED proof, kept in the suite: the #3629 class — the auth chip in the
 * mobile bar instead of the `≡` panel — must still fail on the runtime path.
 * The guest header at 390 is read once as shipped (it must match), then with
 * the one `shell-auth-cluster` moved out of the `≡` panel into the bar, where
 * the parent of #3629 drew it; the check must name the misplaced chip.
 */
export function defineStorefrontHeaderCanvasRedProof(
  options: Omit<StorefrontCanvasParityOptions, "signIn">,
): void {
  const { canvas, rendered } = STOREFRONT_REGIONS.header;
  test.describe(`#3793 header ≡ ds-shell canvas · ${options.host} · guest · 390 · RED proof`, () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test("the auth chip moved from the ≡ panel to the mobile bar fails the runtime check", async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto(options.path);
      await waitForClientReady(page);
      await page
        .locator('[data-testid="shell-auth-cluster"][data-cluster="guest"]')
        .waitFor({ state: "attached" });
      const check = () =>
        canvasStructureMismatch(
          page,
          "ds-shell.dc.html",
          { host: options.host, loggedIn: false, embedded: true },
          { host: options.host, loggedIn: false, mobile: true },
          canvas,
          rendered,
        );
      expect(
        await check(),
        "the shipped header must match before the mutation",
      ).toBeNull();
      await page.evaluate(() => {
        const cluster = document.querySelector(
          '[data-testid="shell-auth-cluster"]',
        );
        const menu = document.querySelector(
          '[data-testid="shell-mobile-menu"]',
        );
        const group = menu?.parentElement;
        if (!cluster || !group?.parentElement)
          throw new Error("header markup changed");
        group.parentElement.insertBefore(cluster, group);
      });
      const mismatch = await check();
      expect(mismatch).toContain(
        "wrong container: link «Войти / Регистрация» — canvas menu, app bar",
      );
    });
  });
}
