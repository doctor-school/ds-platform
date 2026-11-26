import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 033 EARS-2 — «Подать заявку» lives only on the Academy host: the doctor
 * storefront has no `/apply` route (a `doctor.school/apply` request is its
 * not-found page — pinned live by «EARS-2» in `e2e/not-found.spec.ts`), and no
 * doctor source imports the application package `@ds/applications` or the
 * application contract `packages/schemas/src/applications/`.
 */

const DOCTOR = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".next", ".turbo", "test-results"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe("033 EARS-2: the doctor storefront carries nothing of the author application", () => {
  it("EARS-2: has no /apply route segment", () => {
    const segments = walk(join(DOCTOR, "app"))
      .map((path) => relative(join(DOCTOR, "app"), path).split(sep))
      .flatMap((parts) => parts.slice(0, -1));
    expect(segments.filter((s) => /^apply$/i.test(s))).toEqual([]);
  });

  it("EARS-2: imports neither @ds/applications nor the application contract", () => {
    const offenders = walk(DOCTOR)
      .filter(
        (path) =>
          /\.(ts|tsx|mts|js|mjs)$/.test(path) && !path.endsWith(".test.ts"),
      )
      .filter((path) =>
        /@ds\/applications|schemas\/src\/applications|@ds\/schemas\/applications/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => relative(DOCTOR, path));
    expect(offenders).toEqual([]);
    expect(
      readFileSync(join(DOCTOR, "package.json"), "utf8"),
    ).not.toMatch(/"@ds\/applications"/);
  });
});
