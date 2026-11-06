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

import type { BrowserContext, ConsoleMessage, Page } from "@playwright/test";

import { DS_BUNDLE_PATH, dsBundle } from "./ds-bundle.js";

/**
 * #3793 — the CANVAS half of the structural canvas-parity check, on the real
 * Claude Design runtime: a vendored `design-source/*.dc.html` is opened in a
 * page of the spec's own browser context and rendered by the vendored
 * `design-source/support.js` (manifest-pinned), fully offline.
 *
 * Every request of that page is answered here, never by the network:
 *  - `CANVAS_ORIGIN/<path>` → the file under `design-source/` (or an explicit
 *    `files` entry); a missing file is a 404, as in Claude Design for the
 *    unvendored logo SVGs;
 *  - `CANVAS_ORIGIN/_ds/<project>/_ds_bundle.js` → the DS bundle built from
 *    this repo's `@ds/design-system` (`./ds-bundle.ts`, #3798);
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
  | { kind: "ds-bundle" }
  | { kind: "abort"; report: boolean };

export interface CanvasServeOptions {
  /** The folder served at `CANVAS_ORIGIN/` (default `design-source/`). */
  root?: string;
  /**
   * Extra published path → local file, served before `root` and before the
   * built DS bundle.
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
    if (DS_BUNDLE_PATH.test(published)) return { kind: "ds-bundle" };
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

/**
 * #3798 — a runtime console message that means the canvas did NOT render as
 * drawn (pure): every `console.error` of the DC runtime (`[dc-runtime] …` — a
 * `dc-import` sibling that 404s or has no `<x-dc>`, a template or logic that
 * fails to compile, a render error, an `x-import` that fails to load) or of
 * its boot (`[dc] …`), and the `x-import` warnings that a component never
 * appeared (a DS global missing from the bundle). Returns the failure text,
 * or `null` for a message that is not one (an unresolved `{{ }}` hole warns
 * and renders, as in Claude Design).
 */
export function runtimeConsoleFailure(
  type: string,
  text: string,
): string | null {
  const runtime = /^\[dc(-runtime)?\]/.test(text);
  if (!runtime) return null;
  if (type === "error") return text;
  if (type === "warning" && text.startsWith("[dc-runtime] x-import"))
    return text;
  return null;
}

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
 * render settled. Throws on a page error, on a runtime console failure
 * (`runtimeConsoleFailure`) or on any request outside the vendored set.
 */
export async function openRuntimeCanvas(
  context: BrowserContext,
  canvas: string,
  options: OpenCanvasOptions = {},
): Promise<RuntimeCanvas> {
  const page = await context.newPage();
  const unexpected: string[] = [];
  const errors: string[] = [];
  // A failure ends the wait for the render at once, not at its timeout.
  let failed: () => void = () => {};
  const failure = new Promise<"failed">(
    (done) => (failed = () => done("failed")),
  );
  const report = (error: string) => {
    errors.push(error);
    failed();
  };
  page.on("pageerror", (error) => report(String(error)));
  page.on("console", (message: ConsoleMessage) => {
    const text = runtimeConsoleFailure(message.type(), message.text());
    if (text) report(text);
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const decision = decideCanvasRequest(url, options);
    if (decision.kind === "abort") {
      if (decision.report) unexpected.push(url);
      return route.abort();
    }
    if (decision.kind === "missing")
      return route.fulfill({ status: 404, body: "not vendored" });
    if (decision.kind === "ds-bundle") {
      try {
        return route.fulfill({
          status: 200,
          contentType: "text/javascript; charset=utf-8",
          body: await dsBundle(),
        });
      } catch (error) {
        report(`the DS bundle did not build: ${String(error)}`);
        return route.fulfill({ status: 500, body: "DS bundle build failed" });
      }
    }
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
  const settled = async (): Promise<boolean> => {
    const rendered = page
      .waitForFunction(
        // Settled = the template is mounted, and no `x-import` / `dc-import`
        // still draws its loading placeholder (a DS component waits for the
        // bundle a sub-canvas's <helmet> loads; a sibling canvas is fetched).
        (selector) =>
          !document.querySelector("x-dc") &&
          !!document.querySelector(selector) &&
          !document.querySelector(".sc-placeholder, .sc-streaming-html"),
        ready,
        { timeout: 15_000 },
      )
      .then(
        () => "rendered" as const,
        () => "timeout" as const,
      );
    return (await Promise.race([rendered, failure])) === "rendered";
  };
  if (!(await settled())) {
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
    // A variant may mount an import the defaults did not draw.
    if (!(await settled())) {
      return fail(
        `the runtime did not settle for ${JSON.stringify(options.props)}; page errors: ${errors.join(" | ") || "none"}`,
      );
    }
  }
  if (errors.length) return fail(`page errors: ${errors.join(" | ")}`);
  if (unexpected.length)
    return fail(`requests outside the vendored set: ${unexpected.join(", ")}`);
  return { page, close: () => page.close() };
}
