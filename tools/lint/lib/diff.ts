/**
 * tools/lint/lib/diff.ts — the shared «touched in THIS PR» file set + test seam
 * for the lint guards whose severity depends on whether the PR edited the file
 * (Issue #2067; the pattern is `spec-deletion-lint.ts` / `pr-evidence-lint.ts`,
 * which each inlined their own copy of this `git diff` shape).
 *
 * Why it exists: a guard that lands on a repo with pre-existing prose written
 * before the rule existed cannot be a blanket BLOCK without reddening every
 * unrelated PR. The regression-contour tech spec §6.4 writes the resolution into
 * the contract itself — BLOCK for a spec created or modified in the PR, a WARN
 * report row for untouched ones until the §8 backfill waves close — so the check
 * on what the author actually changed is never weakened.
 *
 * TEST SEAM `LINT_DIFF_NAMESTATUS_FILE` — when set, the `git diff --name-status`
 * output is read from that file instead of spawning git, so a guard-test can
 * declare an exact touched set. `LINT_DIFF_BASE` overrides the merge base
 * (default `origin/main`). Both inert in production.
 */
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Statuses whose path is the CURRENT (post-change) path of a touched file. */
const RENAME_OR_COPY = /^[RC]\d*$/;

/**
 * Parse `git diff --name-status --find-renames` output into the set of paths
 * present in the working tree after the change (repo-relative, POSIX slashes).
 * Deletions are excluded: a file that no longer exists cannot carry a finding.
 */
export function parseTouchedPaths(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0].trim();
    if (!status || status.startsWith("D")) continue;
    const path = RENAME_OR_COPY.test(status) ? parts[2] : parts[1];
    if (path) out.add(path.trim());
  }
  return out;
}

/**
 * The set of repo-relative paths this PR created or modified. Reads the
 * `LINT_DIFF_NAMESTATUS_FILE` seam when set, else `git diff --name-status
 * --find-renames <base>...HEAD` in `cwd`. The three-dot form diffs the branch
 * since it diverged from the base.
 *
 * Returns `null` when the diff cannot be taken at all (a shallow checkout with
 * no base ref, a non-git cwd). A caller must treat `null` as «severity unknown»
 * and report rather than block — the guard never invents a touched set.
 */
export async function touchedPaths(cwd: string): Promise<Set<string> | null> {
  const seam = process.env.LINT_DIFF_NAMESTATUS_FILE;
  if (seam) {
    try {
      return parseTouchedPaths(readFileSync(resolve(seam), "utf8"));
    } catch {
      return null;
    }
  }
  const base = process.env.LINT_DIFF_BASE ?? "origin/main";
  try {
    const { stdout } = await execa(
      "git",
      ["diff", "--name-status", "--find-renames", `${base}...HEAD`],
      { cwd },
    );
    return parseTouchedPaths(stdout);
  } catch {
    return null;
  }
}
