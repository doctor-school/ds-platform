#!/usr/bin/env tsx
/**
 * tools/lint/tsc-version-lint.ts — one-compiler guard (#1258, STATIC_GUARDS family).
 *
 * Why this exists: `apps/api` — the service that runs in production — builds with
 * `nest build`, and `@nestjs/cli` declares its OWN `dependencies.typescript`. Under
 * pnpm's isolated layout that nested copy is what the CLI's `require("typescript")`
 * resolves, so until #1258 the api was TYPE-CHECKED on the workspace pin (6.0.3)
 * while the JS actually shipped to prod was EMITTED by 5.9.3. Nothing reported the
 * split: `pnpm typecheck` was green on a compiler that never touched the artifact.
 * The fix is the root `pnpm.overrides.typescript: "$typescript"` entry; this guard
 * exists so the split cannot silently come back on a `@nestjs/cli` bump, an
 * overrides edit, or a new build-toolchain dependency that vendors its own tsc.
 *
 * Checks (any hit ⇒ exit 1):
 *
 *   1. compiler-mismatch — a build-toolchain package (TOOLCHAIN below) resolves a
 *      `typescript` whose version differs from the one the workspace root resolves.
 *      This is the real thing, not a manifest claim: resolution follows Node's own
 *      `node_modules` walk from the package's REAL directory, which is exactly what
 *      the build does at runtime.
 *   2. pin-divergence — a workspace manifest (`apps/*`, `packages/*`) declares a
 *      `typescript` range different from the root manifest's. Two ranges are two
 *      compilers waiting to happen, even when today's install happens to dedupe.
 *
 * Not installed (no `node_modules`, or no `typescript` under the root) ⇒ check 1
 * prints SKIP and exits 0 — a fresh checkout is never a false red. Check 2 is
 * manifest-only and always runs.
 *
 * TEST SEAM: with `LINT_FIXTURE_ROOT` set, the whole scan is rooted at that dir —
 * fixture cases lay out `package.json` + `node_modules/**` trees. Resolution never
 * escapes the root, so a fixture cannot accidentally read the real install.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6; new guard lands WARN, promote to BLOCK
 * once stable). Its `guards-warn` batch step is `continue-on-error`.
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
  if (process.env.LINT_FIXTURE_ROOT) return resolve(process.env.LINT_FIXTURE_ROOT);
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
    encoding: "utf8",
  });
  if (r.status === 0 && r.stdout.trim()) return resolve(r.stdout.trim());
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

const REPO_ROOT = repoRoot();

/**
 * The modules directory the resolution walk looks in. TEST SEAM: fixture cases
 * use `node_modules__fixture/` because a real `node_modules/` inside the repo is
 * git-ignored and could never be committed as a fixture. Production always walks
 * the real `node_modules`.
 */
const MODULES_DIR = process.env.LINT_FIXTURE_ROOT
  ? "node_modules__fixture"
  : "node_modules";

/**
 * Build-toolchain packages that ship their own `typescript` dependency and take
 * part in producing `apps/api`'s emitted JS. Each is resolved FROM `apps/api` —
 * the directory the build actually runs in.
 */
const TOOLCHAIN: { pkg: string; why: string; via?: string }[] = [
  { pkg: "@nestjs/cli", why: "`nest build` — the api's build script" },
  {
    pkg: "@nestjs/schematics",
    why: "nest-cli tsconfig/plugin layer",
    via: "@nestjs/cli",
  },
  {
    pkg: "fork-ts-checker-webpack-plugin",
    why: "nest-cli webpack type-check pass",
    via: "@nestjs/cli",
  },
];

/** Directory the toolchain is resolved from (the api build's cwd). */
const BUILD_ANCHOR_REL = join("apps", "api");

/** Workspace globs scanned for a divergent `typescript` pin. */
const WORKSPACE_DIRS = ["apps", "packages"];

interface Finding {
  kind: "compiler-mismatch" | "pin-divergence";
  detail: string;
}

const REMEDY =
  `${TAG} Remedy: keep ONE compiler for the whole workspace — the root manifest's ` +
  `\`pnpm.overrides.typescript: "$typescript"\` forces every nested copy onto the ` +
  `root \`typescript\` range, and every workspace manifest declares that same range. ` +
  `After editing, re-run \`pnpm install\` so the lockfile matches, then rebuild. ` +
  `Never leave the api emitting on a compiler \`pnpm typecheck\` does not run (#1258).\n`;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** True when `p` is inside REPO_ROOT (resolution must never escape the root). */
function insideRoot(p: string): boolean {
  const rel = relative(REPO_ROOT, p);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(`..${sep}`);
}

/**
 * Node's own resolution walk for a package directory: from `startDir` upwards,
 * the first existing `<ancestor>/node_modules/<pkg>/package.json`. Symlinked
 * (pnpm) entries are resolved to their real path so the walk continues inside
 * `.pnpm/<name>@<ver>/node_modules`, where nested deps actually live. Stops at
 * REPO_ROOT — never resolves against an install outside the tree under test.
 */
function resolvePkgDir(startDir: string, pkg: string): string | null {
  let dir = existsSync(startDir) ? realpathSync(startDir) : startDir;
  for (;;) {
    if (!insideRoot(dir) && dir !== realpathSync(REPO_ROOT)) break;
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
  const m = readManifest(dir);
  const version = typeof m?.version === "string" ? m.version : null;
  return version === null ? null : { version, dir };
}

/** The `typescript` range a manifest declares, in either dependency block. */
function declaredRange(manifest: Record<string, unknown> | null): string | null {
  for (const block of ["devDependencies", "dependencies"] as const) {
    const deps = manifest?.[block] as Record<string, string> | undefined;
    const range = deps?.typescript;
    if (typeof range === "string") return range;
  }
  return null;
}

/** Check 1 — every toolchain package must resolve the root's compiler. */
function checkResolvedCompilers(findings: Finding[]): void {
  const baseline = versionOfTypescriptFrom(REPO_ROOT);
  if (baseline === null) {
    info("SKIP compiler check (no installed `typescript` under the repo root)");
    return;
  }
  info(`workspace compiler: typescript@${baseline.version}`);

  const anchor = join(REPO_ROOT, BUILD_ANCHOR_REL);
  if (!existsSync(anchor)) {
    info(`SKIP compiler check (no ${BUILD_ANCHOR_REL})`);
    return;
  }

  let checked = 0;
  // Resolved dirs of already-visited toolchain packages, so an entry declaring
  // `via` is looked up from ITS parent's real dir (pnpm nests `@nestjs/schematics`
  // and `fork-ts-checker-webpack-plugin` under `@nestjs/cli`, out of the api's walk).
  const resolvedDirs = new Map<string, string>();
  for (const { pkg, why, via } of TOOLCHAIN) {
    const from = via ? (resolvedDirs.get(via) ?? anchor) : anchor;
    const pkgDir = resolvePkgDir(from, pkg);
    if (pkgDir !== null) resolvedDirs.set(pkg, pkgDir);
    if (pkgDir === null) {
      info(`${pkg}: not installed — skipped`);
      continue;
    }
    const resolved = versionOfTypescriptFrom(pkgDir);
    if (resolved === null) {
      info(`${pkg}: resolves no \`typescript\` of its own — inherits the workspace copy`);
      checked += 1;
      continue;
    }
    checked += 1;
    if (resolved.version === baseline.version) {
      info(`${pkg}: typescript@${resolved.version} — matches`);
      continue;
    }
    findings.push({
      kind: "compiler-mismatch",
      detail:
        `${pkg} (${why}) resolves typescript@${resolved.version}, but the workspace ` +
        `runs typescript@${baseline.version} — the emitted artifact would NOT be ` +
        `produced by the compiler \`pnpm typecheck\` uses. Evidence: ` +
        `${relative(REPO_ROOT, resolved.dir) || resolved.dir}`,
    });
  }
  info(`${checked} build-toolchain package(s) checked from ${BUILD_ANCHOR_REL.split(sep).join("/")}`);
}

/** Check 2 — no workspace manifest declares a different `typescript` range. */
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
      const dir = join(groupDir, entry.name);
      const range = declaredRange(readManifest(dir));
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
  checkResolvedCompilers(findings);
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
