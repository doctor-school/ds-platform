import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The repo root, derived from this file's location (tools/lint/guard-tests).
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// The tools/lint dir holding the guards under test.
const LINT_DIR = resolve(REPO_ROOT, "tools", "lint");

// The fixtures dir for this harness.
export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

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
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", guardPath, ...(opts.extraArgs ?? [])],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        LINT_FIXTURE_ROOT: caseDir,
        ...(opts.env ?? {}),
      },
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
