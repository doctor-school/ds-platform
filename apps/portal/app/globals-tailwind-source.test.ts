/**
 * @vitest-environment node
 *
 * Reads files off disk, renders nothing — the portal's default jsdom gives
 * `import.meta.url` a non-file scheme and buys this suite nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Tailwind v4 scans only what it is pointed at. A workspace package that ships
 * TSX SOURCE (`exports` resolving into `src/`) is compiled by this app's bundler
 * but is invisible to the JIT unless the app's entry stylesheet `@source`s it —
 * and the failure is silent: every unit, e2e and axe assertion stays green while
 * the rendered chrome loses every utility class. It bit `@ds/room` (#1722) and
 * again `@ds/storefront-shell` (#2180), where a production image built outside
 * the git tree dropped `bg-header-topbar` / `max-w-container-content` and the
 * storefront footer painted unstyled on the staging slot.
 *
 * The invariant is mechanical, so assert it mechanically: every `@ds/*` package
 * this app imports and that carries TSX under `src/` must be declared in
 * `globals.css`. `@ds/design-system` is the one exception — its own entry
 * stylesheet `@source`s `../primitives` and `../blocks`, and D15 forbids it from
 * sourcing a package downstream of itself.
 */

const CSS_DIR = fileURLToPath(new URL("./", import.meta.url));
const APP_ROOT = path.resolve(CSS_DIR, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const SELF_SOURCING = new Set(["@ds/design-system"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(full);
  }
  return out;
}

function importedDsPackages(): string[] {
  const names = new Set<string>();
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(path.join(APP_ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from "(@ds\/[a-z0-9-]+)(?:\/[^"]*)?"/g))
        names.add(match[1]);
    }
  }
  return [...names].sort();
}

function shipsTsxSource(pkg: string): boolean {
  const src = path.join(REPO_ROOT, "packages", pkg.replace("@ds/", ""), "src");
  return existsSync(src) && walk(src).some((file) => file.endsWith(".tsx"));
}

describe("globals.css Tailwind sources", () => {
  const globals = readFileSync(path.join(CSS_DIR, "globals.css"), "utf8");
  const declared = [...globals.matchAll(/@source\s+"([^"]+)"/g)].map((match) =>
    path.resolve(CSS_DIR, match[1]),
  );

  it("declares every source-shipping @ds package this app renders", () => {
    const missing = importedDsPackages()
      .filter((pkg) => !SELF_SOURCING.has(pkg))
      .filter(shipsTsxSource)
      .filter((pkg) => {
        const src = path.join(
          REPO_ROOT,
          "packages",
          pkg.replace("@ds/", ""),
          "src",
        );
        return !declared.some((dir) => src === dir || src.startsWith(dir));
      });

    expect(missing).toEqual([]);
  });
});
