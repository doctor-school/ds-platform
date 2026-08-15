#!/usr/bin/env tsx
/**
 * tools/lint/tsc-version-lint.ts — one-compiler guard (#1258, STATIC_GUARDS family).
 *
 * What `nest build` actually loads. `apps/api` builds with `nest build`, and the
 * CLI does NOT do a plain `require("typescript")`. Its `TypeScriptBinaryLoader`
 * (`@nestjs/cli/lib/compiler/typescript-loader.js`) resolves:
 *
 *     require.resolve("typescript", { paths: [process.cwd(), ...getModulePaths()] })
 *
 * `process.cwd()` comes FIRST, and `nest build` runs with cwd = `apps/api`, which
 * declares `typescript` itself — so the compiler in effect is the one resolved from
 * `apps/api` upward (the workspace 6.0.3), and a copy vendored inside `@nestjs/cli`
 * is never reached. #1258 was filed on an installed-tree inspection that was correct
 * about what is INSTALLED (`@nestjs/cli@11.0.24` did ship a nested typescript@5.9.3)
 * and wrong about what is LOADED: there was no live compiler divergence, and prod
 * was always built by the workspace pin. The root `pnpm.overrides.typescript`
 * entry is hardening — it removes the stale nested copy so the tree holds ONE
 * compiler — not a defect fix.
 *
 * This guard therefore models the resolution the build performs, cwd-first from
 * `apps/api`, instead of nested-copy proximity. A merely-present nested copy is
 * reported as INFO and is never a finding; what IS a finding is the api's build
 * loading a compiler other than the workspace one, by whatever path.
 *
 * Checks (any hit ⇒ exit 1):
 *
 *   1. build-compiler-mismatch — `typescript` resolved from `apps/api` (Node's own
 *      cwd-first ancestor walk, i.e. what the loader's first `paths` entry does)
 *      differs in version from the one the workspace root resolves. This is the
 *      ground-truth check: it fires whichever link breaks.
 *   2. missing-build-pin — `apps/api/package.json` declares no `typescript` at all.
 *      Its build compiler would then be inherited by accident from an ancestor —
 *      or, if the cwd walk finds nothing, from whatever `getModulePaths()` reaches,
 *      which IS the vendored copy. This is the real re-divergence vector, and a
 *      version comparison alone cannot see it: an absent pin can still resolve to
 *      the right version today and silently stop doing so tomorrow.
 *   3. pin-divergence — a workspace manifest (`apps/*`, `packages/*`) declares a
 *      `typescript` range different from the root manifest's. Two ranges are two
 *      compilers waiting to happen, even when today's install happens to dedupe.
 *
 * Not installed (no `node_modules`, or no `typescript` under the root) ⇒ check 1
 * prints SKIP and exits 0 — a fresh checkout is never a false red. Checks 2 and 3
 * are manifest-only and always run.
 *
 * TEST SEAM: with `LINT_FIXTURE_ROOT` set, the whole scan is rooted at that dir —
 * fixture cases lay out `package.json` + `node_modules__fixture/**` trees (that
 * name, not `node_modules/`, because a real `node_modules/` inside the repo is
 * git-ignored and could never be committed as a fixture). Resolution never escapes
 * the root, so a fixture cannot accidentally read the real install.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6; new guard lands WARN, promote to BLOCK
 * once stable — tracked in `DEBT.md`). Its `guards-warn` batch step is
 * `continue-on-error`.
 *
 * Run: `pnpm lint:tsc-version`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "[tsc-version]";

/** Repo root: the fixture root under test, else the git top-level, else this file's ../.. */
function repoRoot(): string {
  const raw = (() => {
    if (process.env.LINT_FIXTURE_ROOT) return resolve(process.env.LINT_FIXTURE_ROOT);
    const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: here,
      encoding: "utf8",
    });
    return r.status === 0 && r.stdout.trim() ? resolve(r.stdout.trim()) : here;
  })();
  // Realpath ONCE at module scope: the walk below compares against this value, and
  // a root reached through a symlink (git worktrees, some CI checkouts) would
  // otherwise disagree with the realpath'd dirs and end the walk one level early.
  return existsSync(raw) ? realpathSync(raw) : raw;
}

const REPO_ROOT = repoRoot();

/**
 * The modules directory the resolution walk looks in. TEST SEAM: fixture cases use
 * `node_modules__fixture/` (see the header). Production always walks `node_modules`.
 */
const MODULES_DIR = process.env.LINT_FIXTURE_ROOT ? "node_modules__fixture" : "node_modules";

/**
 * The directory `nest build` runs in — the loader's `process.cwd()`, and therefore
 * the first entry of its `require.resolve` `paths`.
 */
const BUILD_ANCHOR_REL = join("apps", "api");

/**
 * Packages that vendor their own `typescript` and sit on (or near) the api's build
 * path. Reported as INFO only: under cwd-first resolution these copies are NOT
 * loaded, so their mere presence is not a finding — this is exactly the harmless
 * pre-#1258 state the first version of this guard would have flagged red.
 */
const VENDORING_PACKAGES = ["@nestjs/cli", "@nestjs/schematics", "fork-ts-checker-webpack-plugin"];

/** Workspace groups scanned for a divergent `typescript` pin. */
const WORKSPACE_DIRS = ["apps", "packages"];

interface Finding {
  kind: "build-compiler-mismatch" | "missing-build-pin" | "pin-divergence";
  detail: string;
}

const REMEDY =
  `${TAG} Remedy: the api's build compiler is whatever \`typescript\` resolves from ` +
  `\`${BUILD_ANCHOR_REL.split(sep).join("/")}\` upward (nest-cli resolves cwd-first). Keep that ` +
  `package's own \`typescript\` dependency declared at the root's range, keep the root ` +
  `\`pnpm.overrides.typescript: "$typescript"\` entry so no vendored copy can linger, and ` +
  `re-run \`pnpm install\`. Never leave the api emitting on a compiler \`pnpm typecheck\` ` +
  `does not run (#1258).\n`;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** True when `p` is inside REPO_ROOT (resolution must never escape the root). */
function insideRoot(p: string): boolean {
  const rel = relative(REPO_ROOT, p);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

/**
 * Node's resolution walk for a package directory, from `startDir` upward: the first
 * existing `<ancestor>/<modules>/<pkg>/package.json`. This IS what
 * `require.resolve(pkg, { paths: [startDir] })` does — the nest-cli loader's first
 * `paths` entry with `startDir` = its cwd. Symlinked (pnpm) entries are resolved to
 * their real path. Stops at REPO_ROOT — never resolves against an install outside
 * the tree under test.
 */
function resolvePkgDir(startDir: string, pkg: string): string | null {
  let dir = existsSync(startDir) ? realpathSync(startDir) : startDir;
  while (insideRoot(dir)) {
    const manifest = join(dir, MODULES_DIR, ...pkg.split("/"), "package.json");
    if (existsSync(manifest)) return realpathSync(dirname(manifest));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readManifest(dir: string): Record<string, unknown> | null {
  const p = join(dir, "package.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

function versionOfTypescriptFrom(startDir: string): { version: string; dir: string } | null {
  const dir = resolvePkgDir(startDir, "typescript");
  if (dir === null) return null;
  const version = readManifest(dir)?.version;
  return typeof version === "string" ? { version, dir } : null;
}

/** The `typescript` range a manifest declares, in either dependency block. */
function declaredRange(manifest: Record<string, unknown> | null): string | null {
  for (const block of ["devDependencies", "dependencies"] as const) {
    const range = (manifest?.[block] as Record<string, string> | undefined)?.typescript;
    if (typeof range === "string") return range;
  }
  return null;
}

/** Check 1 — the compiler `nest build` resolves must be the workspace compiler. */
function checkBuildCompiler(findings: Finding[]): void {
  const workspace = versionOfTypescriptFrom(REPO_ROOT);
  if (workspace === null) {
    info("SKIP compiler check (no installed `typescript` under the repo root)");
    return;
  }
  info(`workspace compiler: typescript@${workspace.version}`);

  const anchor = join(REPO_ROOT, BUILD_ANCHOR_REL);
  if (!existsSync(anchor)) {
    info(`SKIP compiler check (no ${BUILD_ANCHOR_REL.split(sep).join("/")})`);
    return;
  }

  const build = versionOfTypescriptFrom(anchor);
  if (build === null) {
    // Nothing resolvable from the build cwd: the loader would fall through to its
    // getModulePaths() entries — precisely where a vendored copy could win.
    findings.push({
      kind: "build-compiler-mismatch",
      detail:
        `no \`typescript\` resolves from ${BUILD_ANCHOR_REL.split(sep).join("/")} — ` +
        `nest-cli's loader would fall back to its own module paths, where a vendored ` +
        `copy can win`,
    });
    return;
  }

  if (build.version === workspace.version) {
    info(
      `nest build compiler (cwd-first from ${BUILD_ANCHOR_REL.split(sep).join("/")}): ` +
        `typescript@${build.version} — matches. Evidence: ${relative(REPO_ROOT, build.dir) || build.dir}`,
    );
  } else {
    findings.push({
      kind: "build-compiler-mismatch",
      detail:
        `\`nest build\` resolves typescript@${build.version} from ` +
        `${BUILD_ANCHOR_REL.split(sep).join("/")}, but the workspace runs ` +
        `typescript@${workspace.version} — the emitted artifact would NOT be produced by ` +
        `the compiler \`pnpm typecheck\` uses. Evidence: ` +
        `${relative(REPO_ROOT, build.dir) || build.dir}`,
    });
  }

  // INFO only — a vendored nested copy is not loaded under cwd-first resolution.
  for (const pkg of VENDORING_PACKAGES) {
    const pkgDir = resolvePkgDir(anchor, pkg) ?? resolvePkgDir(join(REPO_ROOT, MODULES_DIR), pkg);
    if (pkgDir === null) continue;
    const vendored = versionOfTypescriptFrom(pkgDir);
    if (vendored === null || vendored.dir === build.dir) continue;
    info(
      `note: ${pkg} vendors typescript@${vendored.version} — NOT loaded (cwd-first ` +
        `resolution reaches the workspace copy first); informational, not a finding`,
    );
  }
}

/** Check 2 — the build cwd must PIN its compiler, not inherit one by accident. */
function checkBuildPinDeclared(findings: Finding[]): void {
  const anchorRel = BUILD_ANCHOR_REL.split(sep).join("/");
  const manifest = readManifest(join(REPO_ROOT, BUILD_ANCHOR_REL));
  if (manifest === null) {
    info(`SKIP build-pin check (no ${anchorRel}/package.json)`);
    return;
  }
  const range = declaredRange(manifest);
  if (range === null) {
    findings.push({
      kind: "missing-build-pin",
      detail:
        `${anchorRel}/package.json declares no \`typescript\` — \`nest build\` resolves ` +
        `cwd-first from there, so its compiler would be inherited by accident from an ` +
        `ancestor (or, with none, from nest-cli's own vendored copy). Declaring the ` +
        `dependency is what makes the api's build compiler deterministic`,
    });
    return;
  }
  info(`${anchorRel} pins typescript ${range}`);
}

/** Check 3 — no workspace manifest declares a different `typescript` range. */
function checkDeclaredPins(findings: Finding[]): void {
  const rootRange = declaredRange(readManifest(REPO_ROOT));
  if (rootRange === null) {
    info("SKIP pin check (root manifest declares no `typescript`)");
    return;
  }
  info(`root pin: typescript ${rootRange}`);

  for (const group of WORKSPACE_DIRS) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const range = declaredRange(readManifest(join(groupDir, entry.name)));
      if (range === null || range === rootRange) continue;
      findings.push({
        kind: "pin-divergence",
        detail:
          `${group}/${entry.name}/package.json pins typescript ${range}, the root pins ` +
          `${rootRange} — two ranges are two compilers waiting to happen`,
      });
    }
  }
}

function main(): void {
  const findings: Finding[] = [];
  checkBuildCompiler(findings);
  checkBuildPinDeclared(findings);
  checkDeclaredPins(findings);

  if (findings.length === 0) {
    info("PASS — one TypeScript compiler across typecheck and build.");
    process.exit(0);
  }
  for (const f of findings) {
    process.stderr.write(`${TAG} ${f.kind}  ${f.detail}\n`);
  }
  process.stderr.write(`${TAG} FAIL — ${findings.length} compiler-split finding(s).\n`);
  process.stderr.write(REMEDY);
  process.exit(1);
}

try {
  main();
} catch (e) {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
}
