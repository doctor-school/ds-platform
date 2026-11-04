import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 048 EARS-17 (#3514) — the rail and the reading page live only on the
 * Academy host: the doctor storefront has no `/materials` route (a
 * `doctor.school/materials/{slug}` request is its not-found page — pinned live
 * in `e2e/materials-absence.spec.ts`), and no doctor source imports anything of
 * the feed or material contract `packages/schemas/src/materials/`, nor the
 * material blocks of `@ds/design-system`.
 */

const DOCTOR = fileURLToPath(new URL("..", import.meta.url));
const MATERIALS_CONTRACT = fileURLToPath(
  new URL("../../../packages/schemas/src/materials/", import.meta.url),
);
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

/** Every name the materials contract exports (the `@ds/schemas` barrel re-exports them). */
function contractNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MATERIALS_CONTRACT)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const source = readFileSync(join(MATERIALS_CONTRACT, file), "utf8");
    for (const match of source.matchAll(
      /export\s+(?:const|type|interface|function|enum)\s+(\w+)/g,
    ))
      names.add(match[1]!);
  }
  return names;
}

const sources = walk(DOCTOR).filter(
  (path) => /\.(ts|tsx|mts|js|mjs)$/.test(path) && !path.endsWith(".test.ts"),
);

describe("048 EARS-17: the doctor storefront carries nothing of the materials feed", () => {
  it("EARS-17: has no /materials route segment", () => {
    const appFiles = walk(join(DOCTOR, "app")).map((path) =>
      relative(join(DOCTOR, "app"), path).split(sep),
    );
    const segments = appFiles.flatMap((parts) => parts.slice(0, -1));
    expect(segments.filter((segment) => /^materials$/i.test(segment))).toEqual(
      [],
    );
  });

  it("EARS-17: imports no name of packages/schemas/src/materials/ and no material block", () => {
    const names = contractNames();
    expect(names.size).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      if (/schemas\/src\/materials|@ds\/schemas\/materials/.test(source))
        offenders.push(`${relative(DOCTOR, path)}: materials path`);
      if (
        /@ds\/design-system\/(material-article|rich-text-content)/.test(source)
      )
        offenders.push(`${relative(DOCTOR, path)}: material block`);
      for (const match of source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@ds\/(?:schemas|design-system(?:\/blocks)?)["']/g,
      )) {
        for (const raw of match[1]!.split(",")) {
          const name = raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]!;
          if (
            names.has(name) ||
            ["MaterialArticle", "RichTextContent"].includes(name)
          )
            offenders.push(`${relative(DOCTOR, path)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
