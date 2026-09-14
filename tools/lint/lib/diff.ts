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
 * What «modified» means for a `.feature` file: a change to the SCENARIOS, not to
 * the file's bytes. The C6 suite selects each feature file by a Feature-level
 * `@host:*` tag (regression-contour tech spec §6.1,
 * `packages/e2e/lib/host-tags.ts`), and adding or retargeting that tag is a
 * SUITE-SELECTION edit: it changes which storefront runs the scenarios, never
 * what they cover or how they assert. Counting it as authorship would make a
 * repo-wide selection pass inherit the whole §8 backfill debt of every spec it
 * annotated — exactly the «reddening every unrelated PR» the split exists to
 * prevent. So a `.feature` path whose entire diff is host-tag lines is dropped
 * from the touched set; change ONE scenario line in the same file and it counts.
 *
 * TEST SEAM `LINT_DIFF_NAMESTATUS_FILE` — when set, the `git diff --name-status`
 * output is read from that file instead of spawning git, so a guard-test can
 * declare an exact touched set; `LINT_DIFF_CONTENT_DIR` supplies the per-file
 * `git diff -U0` output behind the suite-selection filter (without it the filter
 * is skipped, so a fixture's declared touched set is taken as given).
 * `LINT_DIFF_BASE` overrides the merge base (default `origin/main`). All inert
 * in production.
 */
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Statuses whose path is the CURRENT (post-change) path of a touched file. */
const RENAME_OR_COPY = /^[RC]\d*$/;

/** A Gherkin tag line carrying host tags and nothing else. */
const HOST_TAG_ONLY_LINE = /^\s*@host:\S+(\s+@host:\S+)*\s*$/;

/** The `git diff -U0` body of one file, seam-aware. `null` = could not be taken. */
async function fileDiff(cwd: string, path: string): Promise<string | null> {
  const seamDir = process.env.LINT_DIFF_CONTENT_DIR;
  if (seamDir) {
    try {
      return readFileSync(
        resolve(seamDir, `${path.split("/").join("__")}.diff`),
        "utf8",
      );
    } catch {
      return null;
    }
  }
  const base = process.env.LINT_DIFF_BASE ?? "origin/main";
  try {
    const { stdout } = await execa(
      "git",
      ["diff", "-U0", "--find-renames", `${base}...HEAD`, "--", path],
      { cwd },
    );
    return stdout;
  } catch {
    return null;
  }
}

/**
 * True when every added/removed line of this file's diff is a host-tag line —
 * a suite-selection edit, not an edit to what the scenarios cover or assert.
 * An undecidable diff (`null`) answers false: the file stays touched, which is
 * the strict side.
 */
export function isSuiteSelectionOnly(diff: string | null): boolean {
  if (diff === null) return false;
  const changed = diff
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.startsWith("+") || line.startsWith("-")) &&
        !line.startsWith("+++") &&
        !line.startsWith("---"),
    )
    .map((line) => line.slice(1));
  if (changed.length === 0) return false;
  return changed.every((line) => HOST_TAG_ONLY_LINE.test(line));
}

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
  let paths: Set<string>;
  if (seam) {
    try {
      paths = parseTouchedPaths(readFileSync(resolve(seam), "utf8"));
    } catch {
      return null;
    }
    // Without the content seam a fixture's declared touched set is taken as given.
    if (!process.env.LINT_DIFF_CONTENT_DIR) return paths;
  } else {
    const base = process.env.LINT_DIFF_BASE ?? "origin/main";
    try {
      const { stdout } = await execa(
        "git",
        ["diff", "--name-status", "--find-renames", `${base}...HEAD`],
        { cwd },
      );
      paths = parseTouchedPaths(stdout);
    } catch {
      return null;
    }
  }
  const out = new Set<string>();
  for (const path of paths) {
    if (
      path.endsWith(".feature") &&
      isSuiteSelectionOnly(await fileDiff(cwd, path))
    ) {
      continue;
    }
    out.add(path);
  }
  return out;
}
