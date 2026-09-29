import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #2018 — the storefront favicon. Without an icon the browser falls back to
 * `GET /favicon.ico`, which 404s on this host and litters the console. The App
 * Router file convention `app/icon.svg` makes Next emit
 * `<link rel="icon" href="/icon.svg?…" type="image/svg+xml">` in every document
 * head and serve the file at `/icon.svg`, so the fallback request never fires.
 *
 * The icon is the brand mark cut out of the logo (owner 2026-09-29: the sickles
 * inscribed in a circle), not a redrawing: its paths must stay byte-identical to
 * the first three paths of `public/brand/logo.svg`, and the wordmark
 * (`#1D1D1B`) must not leak in. The viewBox is square so the tab icon is not
 * letterboxed.
 *
 * `app/favicon.ico` is the same mark rasterised (16/32/48, PNG-in-ICO) for the
 * clients that still ask for `/favicon.ico` directly: browsers without SVG
 * favicon support (Safari before 26) and crawlers such as the Yandex favicon
 * robot. It resolves 200 instead of the 404 the Issue reported.
 */

const APP_DIR = fileURLToPath(new URL("./", import.meta.url));
const ICON = path.join(APP_DIR, "icon.svg");
const FAVICON = path.join(APP_DIR, "favicon.ico");
const LOGO = path.resolve(APP_DIR, "../public/brand/logo.svg");

function paths(svg: string): string[] {
  return svg.match(/<path\b[^>]*\/>/g) ?? [];
}

describe("app/icon.svg — the favicon is the logo mark", () => {
  it("exists as the App Router icon file convention", () => {
    expect(existsSync(ICON)).toBe(true);
  });

  it("carries exactly the logo's three mark paths, byte for byte", () => {
    const icon = readFileSync(ICON, "utf8");
    const logo = readFileSync(LOGO, "utf8");
    expect(paths(icon)).toEqual(paths(logo).slice(0, 3));
    expect(icon).not.toContain("#1D1D1B");
  });

  it("has a square viewBox", () => {
    const icon = readFileSync(ICON, "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(icon)?.[1]?.split(/\s+/).map(Number);
    expect(viewBox).toHaveLength(4);
    expect(viewBox?.[2]).toBeGreaterThan(0);
    expect(viewBox?.[2]).toBe(viewBox?.[3]);
  });

  it("ships favicon.ico as a real ICO with 16, 32 and 48 px entries", () => {
    expect(existsSync(FAVICON)).toBe(true);
    const ico = readFileSync(FAVICON);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
  });
});
