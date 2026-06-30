#!/usr/bin/env tsx
/**
 * tools/lint/showcase-coverage-lint.ts — coverage gate for the design-system
 * living showcase (design-system-showcase spec §5.1, epic #340 deliverable B,
 * child #350).
 *
 * Why this exists: the showcase (`apps/showcase`) is the rendered viewer of the
 * ONE design system (`@ds/design-system`) — its value is that it is *living*:
 * every export of the package has a catalogued entry, so the owner reviews the
 * system as a unit (Stage B) and a new primitive/block cannot ship without
 * appearing in the catalogue. The "3+ engineers keep the docs alive" social
 * guarantee does not hold for a solo Tech Lead (§1.1), so this guard is the
 * machine substitute (§5): it asserts every `@ds/design-system` COMPONENT export
 * has a corresponding entry in the showcase registry
 * (`apps/showcase/app/lib/registry.ts`). A component added to the package without
 * a registry entry fails the guard.
 *
 * What it checks — the GRANULARITY RULE (spec §3.2/§3.3, §6 "unit-as-subject"),
 * derived from the package source so a FUTURE primitive/block is caught (the
 * required set is NOT hardcoded):
 *
 *   - Read `packages/design-system/package.json` `exports`. A subpath whose target
 *     is a single-file primitive under `src/primitives/` (`./button`, `./card`,
 *     `./input`, `./input-otp`, `./label`, `./link`, `./tabs`, `./form`) is ONE
 *     unit, id = the subpath basename. Sub-components (CardHeader, FormControl,
 *     TabsList, InputOTPGroup, …) are NOT separate units — they are catalogued
 *     under their parent primitive.
 *   - The MULTI-COMPONENT subpaths `./fields` and `./blocks` each expand to their
 *     individual COMPONENT named exports: their target `index.ts` is read and its
 *     PascalCase named exports are regex-extracted, EXCLUDING non-component exports
 *     (`*Schema` resolver fragments, `mask*` / `use*` helpers, anything listed in
 *     the registry's `NON_CATALOGUED_EXPORTS`). These index files re-export sibling
 *     modules so they cannot be dynamically imported in a fixture tree — regex over
 *     the `export { … }` / `export const X` forms is the seam-safe extraction,
 *     matching house style (cf. `interaction-states-lint`).
 *   - Excluded entirely: the barrel `.`, `./lib/utils`, and any `*.css` / `*.json`
 *     subpath — these carry no rendered visual unit (`./lib/utils` is `cn`, tokens
 *     are catalogued from the manifest, §3.1, not from a component export).
 *
 * The registry side: the guard dynamically `import()`s the showcase registry
 * module and reads `SHOWCASE_REGISTRY` → the set of catalogued ids. The module is
 * SELF-CONTAINED by contract (spec §7 — no `@ds/design-system` import), which is
 * what makes this dynamic import work from the `LINT_FIXTURE_ROOT` seam.
 *
 * Assertion: every derived required id must appear in the registry id set. Any
 * missing id fails — the message names the package export and tells the author to
 * add a registry entry. The registry's `NON_CATALOGUED_EXPORTS` is the declarative
 * record of the helpers/schemas/types deliberately left out, so the gap is a
 * surfaced decision, not a silent omission.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6: new AI-specific guards land as WARN,
 * promote to BLOCK once stable), consistent with `registry-research` / `no-stub` /
 * `interaction-states`. The CI job uses `continue-on-error` — the WARN posture is
 * the CI config, NOT a suppressed exit code here.
 *
 * Run: `pnpm lint:showcase-coverage`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at a
// fixture tree (tools/lint/guard-tests). Inert in production — when unset the root
// resolves to the repo root exactly as before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[showcase-coverage]";

const PACKAGE_JSON = "packages/design-system/package.json";
const REGISTRY_MODULE = "apps/showcase/app/lib/registry.ts";

// The two multi-component subpaths whose target index re-exports several
// component units (spec §3.2 fields, §3.3 blocks). Each expands to its individual
// PascalCase component exports rather than contributing one unit.
const MULTI_COMPONENT_SUBPATHS = new Set(["./fields", "./blocks"]);

// Subpaths that carry no rendered visual unit and are never catalogued.
const EXCLUDED_SUBPATHS = new Set([".", "./lib/utils"]);

interface RegistryEntry {
  id: string;
  section: string;
}
interface RegistryModule {
  SHOWCASE_REGISTRY: RegistryEntry[];
  NON_CATALOGUED_EXPORTS?: string[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

/**
 * Extract the PascalCase COMPONENT named exports from a multi-component index
 * (`src/blocks/index.ts`, `src/primitives/fields/index.ts`), excluding the
 * non-component exports (`*Schema`, `mask*`, `use*`, anything in
 * `nonCatalogued`). Regex over `export { … }` and `export const/function X` —
 * the index re-exports sibling modules, so a dynamic import is not possible; regex
 * is the seam-safe extraction (house style, cf. interaction-states-lint).
 */
function extractComponentExports(src: string, nonCatalogued: Set<string>): string[] {
  const names = new Set<string>();

  // `export { A, B as C } from "./x"` / `export { A, B }`
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(",")) {
      // `B as C` → the exported name is `C`; a bare `A` → `A`.
      const part = raw.trim();
      if (!part) continue;
      const asMatch = part.match(/\bas\s+(\w+)\s*$/);
      const name = asMatch ? asMatch[1] : part.split(/\s+/)[0];
      if (name) names.add(name);
    }
  }
  // `export const X = …` / `export function X(…)` / `export class X`
  for (const m of src.matchAll(/export\s+(?:const|function|class)\s+(\w+)/g)) {
    names.add(m[1]);
  }

  // A unit is a COMPONENT: PascalCase, and not a deliberately-excluded export.
  return [...names].filter(
    (n) =>
      /^[A-Z][A-Za-z0-9]*$/.test(n) && // PascalCase component
      !/Schema$/.test(n) && // zod resolver fragment
      !nonCatalogued.has(n),
  );
}

/**
 * Derive the required catalogued set R from the package source under the scan root.
 * `nonCatalogued` is the registry's documented exclusion list, used when expanding
 * the multi-component subpaths.
 */
function deriveRequiredIds(nonCatalogued: Set<string>): string[] {
  let pkgRaw: string;
  try {
    pkgRaw = read(PACKAGE_JSON);
  } catch {
    fail(
      `cannot read ${PACKAGE_JSON} under the scan root — the package export map is the source of the required catalogued set.`,
    );
  }
  const pkg = JSON.parse(pkgRaw) as { exports?: Record<string, unknown> };
  const exportsMap = pkg.exports ?? {};

  const required: string[] = [];
  for (const subpath of Object.keys(exportsMap)) {
    if (EXCLUDED_SUBPATHS.has(subpath)) continue;
    if (/\.(css|json)$/.test(subpath)) continue;

    if (MULTI_COMPONENT_SUBPATHS.has(subpath)) {
      const target = exportsMap[subpath];
      if (typeof target !== "string") continue;
      const indexRel = resolve(dirname(resolve(REPO_ROOT, PACKAGE_JSON)), target);
      let indexSrc: string;
      try {
        indexSrc = readFileSync(indexRel, "utf8");
      } catch {
        fail(
          `cannot read the multi-component index for "${subpath}" (${target}) — needed to expand its component exports.`,
        );
      }
      required.push(...extractComponentExports(indexSrc, nonCatalogued));
      continue;
    }

    // A single-file primitive subpath → one unit, id = the basename.
    required.push(subpath.replace(/^\.\//, ""));
  }
  // De-dup defensively.
  return [...new Set(required)];
}

async function loadRegistry(): Promise<RegistryModule> {
  const modPath = resolve(REPO_ROOT, REGISTRY_MODULE);
  let mod: RegistryModule;
  try {
    mod = (await import(pathToFileURL(modPath).href)) as RegistryModule;
  } catch (e) {
    fail(
      `could not import the showcase registry (${REGISTRY_MODULE}): ${(e as Error).message}. ` +
        `It must be self-contained (no @ds/design-system import) per spec §7.`,
    );
  }
  if (!Array.isArray(mod.SHOWCASE_REGISTRY)) {
    fail(`${REGISTRY_MODULE} does not export a SHOWCASE_REGISTRY array.`);
  }
  return mod;
}

async function main(): Promise<void> {
  const registry = await loadRegistry();
  const nonCatalogued = new Set(registry.NON_CATALOGUED_EXPORTS ?? []);
  const cataloguedIds = new Set(registry.SHOWCASE_REGISTRY.map((e) => e.id));

  const required = deriveRequiredIds(nonCatalogued);
  const missing = required.filter((id) => !cataloguedIds.has(id));

  if (missing.length > 0) {
    fail(
      `${missing.length} @ds/design-system component export(s) have no showcase registry entry:\n` +
        missing.map((id) => `    - ${id}`).join("\n") +
        `\n  Add a { id, section } entry for each to ${REGISTRY_MODULE} (SHOWCASE_REGISTRY), ` +
        `or, if it is a deliberately non-visual export, list it in NON_CATALOGUED_EXPORTS. ` +
        `The showcase must catalogue every primitive/block the package exports (spec §5.1).`,
    );
  }

  info(
    `OK — all ${required.length} catalogued unit(s) of @ds/design-system have a showcase registry entry ` +
      `(${cataloguedIds.size} registry entries, ${nonCatalogued.size} deliberately non-catalogued).`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
