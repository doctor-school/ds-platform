import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The repo root, derived from this file's location (tools/lint/guard-tests).
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// The tools/lint dir holding the guards under test.
const LINT_DIR = resolve(REPO_ROOT, "tools", "lint");

// The fixtures dir for this harness.
export const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

export interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunGuardOptions {
  /** Extra CLI args appended after the guard path (e.g. `--generate`). */
  extraArgs?: string[];
  /**
   * Extra env vars layered over `process.env` + `LINT_FIXTURE_ROOT`. Used by the
   * external-context guards to point the `gh` seam (`LINT_GH_FIXTURE_DIR`), the
   * memory seam (`LINT_MEMORY_FILE`), or the Actions context (`GITHUB_EVENT_NAME`,
   * `PR_NUMBER`) at fixtures — and to override any ambient CI values (the `unit`
   * job runs inside a real `pull_request` event) so the run stays deterministic.
   */
  env?: Record<string, string>;
  /** Legacy projected mocks need a full synthetic GitHub response. Disable for explicit malformed/missing-metadata fixtures. */
  completeLegacyGhFixtures?: boolean;
}

/** Complete old projected test responses without changing committed fixtures or production validation. */
function legacyGhResponses(source: string): string {
  const target = mkdtempSync(join(tmpdir(), "lint-gh-responses-"));
  cpSync(source, target, { recursive: true });
  for (const name of readdirSync(target)) {
    const match = name.match(/^pr-view-(\d+)\.json$/);
    if (!match) continue;
    const file = join(target, name);
    let pr: Record<string, unknown>;
    try {
      pr = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) continue;
    // Some older body-only projections omitted files entirely; their synthetic
    // response has no changed paths. Explicit malformed values stay untouched.
    if (!Object.hasOwn(pr, "files")) pr.files = [];
    if (!Array.isArray(pr.files)) continue;
    if (!Object.hasOwn(pr, "changedFiles")) pr.changedFiles = pr.files.length;
    if (!Object.hasOwn(pr, "headRefOid"))
      pr.headRefOid =
        typeof pr.body === "string"
          ? (pr.body.match(/^Stage-B-head:\s*([a-f0-9]{40})$/im)?.[1] ??
            "d".repeat(40))
          : "d".repeat(40);
    writeFileSync(file, JSON.stringify(pr));
    const listing = join(target, `pr-files-${match[1]}.json`);
    if (!existsSync(listing)) {
      const rows = pr.files;
      const pages = Array.from(
        { length: Math.max(1, Math.ceil(rows.length / 100)) },
        (_, index) => rows.slice(index * 100, (index + 1) * 100),
      );
      writeFileSync(listing, JSON.stringify(pages));
    }
  }
  return target;
}

/**
 * Spawn a real lint guard as a subprocess with `LINT_FIXTURE_ROOT` pointed at a
 * fixture-case dir, returning its exit code + captured streams.
 *
 * We invoke through `pnpm exec tsx` (not a bare `tsx`) so the same resolution
 * path runs on the Windows dev box and on the ubuntu CI runner; `shell: true` on
 * win32 lets the `pnpm` shim resolve. The guard reads `LINT_FIXTURE_ROOT` (its
 * test seam) and scans the fixture tree instead of the real repo.
 */
export function runGuard(
  guardFile: string,
  caseDir: string,
  opts: RunGuardOptions = {},
): GuardResult {
  const guardPath = resolve(LINT_DIR, guardFile);
  const env = {
    ...process.env,
    LINT_FIXTURE_ROOT: caseDir,
    ...(opts.env ?? {}),
  };
  const fixtureSource = opts.env?.LINT_GH_FIXTURE_DIR;
  const fixtureCopy =
    fixtureSource &&
    existsSync(fixtureSource) &&
    opts.completeLegacyGhFixtures !== false
      ? legacyGhResponses(fixtureSource)
      : undefined;
  if (fixtureCopy) env.LINT_GH_FIXTURE_DIR = fixtureCopy;
  try {
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", guardPath, ...(opts.extraArgs ?? [])],
      {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    return {
      // `.status` is null if the process was killed by a signal; surface that as -1.
      code: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    if (fixtureCopy) rmSync(fixtureCopy, { recursive: true, force: true });
  }
}

/** Absolute path to a fixture case dir: fixtures/<guard>/<case>. */
export function caseDir(guard: string, name: string): string {
  return resolve(FIXTURES_DIR, guard, name);
}

/**
 * Absolute path to a fixture case's `gh` sub-dir (canned `gh` JSON for the
 * `LINT_GH_FIXTURE_DIR` seam): fixtures/<guard>/<case>/gh.
 */
export function ghDir(guard: string, name: string): string {
  return resolve(FIXTURES_DIR, guard, name, "gh");
}
