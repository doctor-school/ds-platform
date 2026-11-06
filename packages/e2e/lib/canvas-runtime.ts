import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  isAbsolute,
} from "node:path";
import { fileURLToPath } from "node:url";

import type { BrowserContext, Page } from "@playwright/test";

/**
 * #3793 — the CANVAS half of the structural canvas-parity check, on the real
 * Claude Design runtime: a vendored `design-source/*.dc.html` is opened in a
 * page of the spec's own browser context and rendered by the vendored
 * `design-source/support.js` (manifest-pinned), fully offline.
 *
 * Every request of that page is answered here, never by the network:
 *  - `CANVAS_ORIGIN/<path>` → the file under `design-source/` (or an explicit
 *    `files` entry, e.g. a DS bundle built from this repo); a missing file is a
 *    404, as in Claude Design for the unvendored logo SVGs;
 *  - the React / ReactDOM 18.3.1 UMD URLs `support.js` pins with SRI → the
 *    `react-18-umd` / `react-dom-18-umd` npm aliases of `@ds/e2e`;
 *  - Google Fonts → aborted (the structure carries no font);
 *  - anything else → aborted AND reported: the load fails naming the URL, so
 *    a canvas that needs a new external resource is a visible failure, not a
 *    silently different render.
 */

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

/** The vendored canvas folder the runtime pages are served from. */
export const DESIGN_SOURCE = resolve(REPO, "design-source");

/** A non-routable origin: only `page.route` below ever answers it. */
export const CANVAS_ORIGIN = "http://design-source.invalid";

const require = createRequire(import.meta.url);
const umd = (pkg: string, file: string): string =>
  join(dirname(require.resolve(`${pkg}/package.json`)), "umd", file);

/** The runtime's pinned UMD URLs (support.js `REACT_URL` / `REACT_DOM_URL`) → local copies. */
export const RUNTIME_VENDOR: Readonly<Record<string, string>> = {
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": umd(
    "react-18-umd",
    "react.production.min.js",
  ),
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": umd(
    "react-dom-18-umd",
    "react-dom.production.min.js",
  ),
};

const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

export type CanvasRequestDecision =
  | { kind: "file"; path: string }
  | { kind: "missing" }
  | { kind: "vendor"; path: string }
  | { kind: "abort"; report: boolean };

export interface CanvasServeOptions {
  /** The folder served at `CANVAS_ORIGIN/` (default `design-source/`). */
  root?: string;
  /**
   * Extra published path → local file, served before `root` — e.g. the DS
   * bundle `_ds/<…>/_ds_bundle.js` a DS-bundle canvas loads, built from this
   * repo's `@ds/design-system`.
   */
  files?: Readonly<Record<string, string>>;
}

/** Where a request of a runtime canvas page is answered from (pure). */
export function decideCanvasRequest(
  url: string,
  options: CanvasServeOptions = {},
): CanvasRequestDecision {
  const vendored = RUNTIME_VENDOR[url];
  if (vendored) return { kind: "vendor", path: vendored };
  const parsed = new URL(url);
  if (parsed.origin === CANVAS_ORIGIN) {
    const published = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    const mapped = options.files?.[published];
    if (mapped) return { kind: "file", path: mapped };
    const root = options.root ?? DESIGN_SOURCE;
    const path = resolve(root, published);
    const inside = relative(root, path);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside))
      return { kind: "missing" };
    if (!existsSync(path) || statSync(path).isDirectory())
      return { kind: "missing" };
    return { kind: "file", path };
  }
  return { kind: "abort", report: !FONT_HOSTS.has(parsed.hostname) };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface OpenCanvasOptions extends CanvasServeOptions {
  /**
   * Variant props, applied through the runtime's
   * `window.__dcSetProps(window.__dcRootName(), props)` over the canvas's
   * `data-props` defaults. The 390/1440 branch is the context's viewport.
   */
  props?: Record<string, unknown>;
  /** Rendered once this matches (default: an artboard under `#dc-root`). */
  ready?: string;
}

export interface RuntimeCanvas {
  page: Page;
  close(): Promise<void>;
}

/**
 * Open `canvas` (a file name under `design-source/`) in a new page of
 * `context`, rendered by the real runtime with `props`; resolves once the
 * render settled. Throws on a page error or on any request outside the
 * vendored set.
 */
export async function openRuntimeCanvas(
  context: BrowserContext,
  canvas: string,
  options: OpenCanvasOptions = {},
): Promise<RuntimeCanvas> {
  const page = await context.newPage();
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const decision = decideCanvasRequest(url, options);
    if (decision.kind === "abort") {
      if (decision.report) unexpected.push(url);
      return route.abort();
    }
    if (decision.kind === "missing")
      return route.fulfill({ status: 404, body: "not vendored" });
    return route.fulfill({
      status: 200,
      contentType: TYPES[extname(decision.path)] ?? "application/octet-stream",
      // SRI on a cross-origin <script> needs a CORS response.
      headers: { "access-control-allow-origin": "*" },
      body: readFileSync(decision.path),
    });
  });
  const fail = async (what: string): Promise<never> => {
    await page.close();
    throw new Error(`${canvas}: ${what}`);
  };
  await page.goto(`${CANVAS_ORIGIN}/${canvas}`);
  const ready = options.ready ?? "#dc-root [data-screen-label]";
  try {
    await page.waitForFunction(
      (selector) =>
        !document.querySelector("x-dc") && !!document.querySelector(selector),
      ready,
      { timeout: 15_000 },
    );
  } catch {
    return fail(
      `the runtime did not render «${ready}»; page errors: ${errors.join(" | ") || "none"}; blocked: ${unexpected.join(", ") || "none"}`,
    );
  }
  if (options.props) {
    await page.evaluate((props) => {
      const dc = window as unknown as {
        __dcSetProps(root: string, props: Record<string, unknown>): void;
        __dcRootName(): string;
      };
      dc.__dcSetProps(dc.__dcRootName(), props);
    }, options.props);
    // Let React commit the new props and the browser lay them out.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  }
  if (errors.length) return fail(`page errors: ${errors.join(" | ")}`);
  if (unexpected.length)
    return fail(`requests outside the vendored set: ${unexpected.join(", ")}`);
  return { page, close: () => page.close() };
}
