#!/usr/bin/env tsx
/**
 * tools/lint/spec-deletion-lint.ts — WARN v1 guard: a PR must not DELETE a
 * feature-spec / ADR file. Specs and ADRs are retired by a `status: Superseded`
 * (or `status: Retired`) frontmatter transition, NEVER by file removal
 * (AGENTS.md §6 "Amendment vs inline rewrite"; ADR-0006 §7). A `git rm` bundled
 * into an unrelated feature PR silently deleted a complete two-tier spec layer
 * (10 files) — the real incident this guard exists to catch (Issue #971).
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * A PR that DELETES (`git diff --name-status` status `D`) any file under
 *   - `apps/docs/content/specs/**`
 *   - `apps/docs/content/adr/**`
 * matching `*.md` or `*.feature` is flagged — UNLESS a sanctioned escape holds:
 *   (a) SUPERSEDE TRANSITION — the PR also carries a `status: Superseded` /
 *       `status: Retired` frontmatter on a modified spec/ADR file (a documented
 *       retirement wave; the deletions are its sanctioned collateral); OR
 *   (b) BODY MARKER — the PR body carries `spec-deletion: <reason + superseding
 *       ref>` (an explicit, greppable justification); OR
 *   (c) the change is a pure MOVE/RENAME (`git` detects `R` under
 *       `--find-renames`) — a rename is not a deletion and never trips the guard.
 *
 * ── Seam (pure fn + thin wrapper) ─────────────────────────────────────────────
 * `evaluateSpecDeletion(entries, supersededPaths, prBody)` is a PURE function
 * (unit-tested directly) taking the parsed `--name-status` entries, the set of
 * modified spec/ADR files that now carry a Superseded/Retired frontmatter, and
 * the PR body → a pass/fail verdict naming the offending deletions. The wrapper
 * only computes those three inputs (git diff + tree reads + `gh pr view body`).
 *
 * Seams (inert in production): `LINT_DIFF_NAMESTATUS_FILE` serves a canned
 * `git diff --name-status --find-renames` output instead of spawning git;
 * `LINT_FIXTURE_ROOT` points the Superseded-frontmatter tree reads at a fixture
 * tree; `LINT_GH_FIXTURE_DIR` (lib/gh.ts) + `PR_BODY` serve the PR body.
 *
 * PR-event-gated: on a non-`pull_request` run it exits 0 (the deletion signal
 * only matters at PR review time). Findings: stderr, exit 1. Clean/skip: stdout,
 * exit 0.
 *
 * ── SEVERITY: WARN ────────────────────────────────────────────────────────────
 * The guard exits non-zero on a finding; its CI job (`spec-deletion` in
 * `.github/workflows/pr-body-guards.yml`) carries `continue-on-error: true`, so
 * a finding surfaces as a WARN, not a merge blocker (ADR-0007 §2.6 new-guard
 * posture). TO PROMOTE TO BLOCK: drop `continue-on-error: true` from that one CI
 * job — the guard code needs no change.
 */
import { execa } from "execa";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[spec-deletion]";

/** SEVERITY — single clearly-marked constant (documentation; see file header). */
export const SEVERITY = "WARN" as const;

/**
 * A retireable artifact: a `.md`/`.feature` file under the specs or adr content
 * trees. Deleting one of these is what the guard flags.
 */
export const RETIREABLE_PATH_RE =
  /^apps\/docs\/content\/(?:specs|adr)\/.+\.(?:md|feature)$/;

/**
 * The explicit body justification marker. `spec-deletion: <reason + ref>` —
 * requires a non-empty value after the colon.
 */
export const SPEC_DELETION_MARKER_RE = /^\s*spec-deletion:\s*\S.*$/im;

/** A retirement frontmatter status that sanctions accompanying deletions. */
export const RETIRE_STATUS_RE = /^status:\s*["']?(Superseded|Retired)\b/im;

export interface DiffEntry {
  /** Raw `--name-status` code: `A`, `D`, `M`, `R100`, `C075`, … */
  status: string;
  /** New/current path (destination for a rename). */
  path: string;
  /** Source path for a rename/copy (`R`/`C`), else undefined. */
  oldPath?: string;
}

export interface Verdict {
  ok: boolean;
  /** Deleted retireable paths (populated whether or not an escape applies). */
  offenders: string[];
  /** Which sanctioned escape passed the PR, or null. */
  escape: "marker" | "superseded-transition" | null;
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isRetireablePath(p: string): boolean {
  return RETIREABLE_PATH_RE.test(normalize(p));
}

export function isDeletion(status: string): boolean {
  return status.charAt(0) === "D";
}

export function isRenameOrCopy(status: string): boolean {
  const c = status.charAt(0);
  return c === "R" || c === "C";
}

/**
 * PURE core (unit-tested). Given the parsed diff entries, the set of modified
 * spec/ADR files that now carry a Superseded/Retired frontmatter, and the PR
 * body, decide whether the PR is clean.
 */
export function evaluateSpecDeletion(
  entries: DiffEntry[],
  supersededPaths: string[],
  prBody: string,
): Verdict {
  const offenders = entries
    .filter((e) => isDeletion(e.status) && isRetireablePath(e.path))
    .map((e) => normalize(e.path));

  if (offenders.length === 0) {
    return { ok: true, offenders: [], escape: null };
  }
  if (SPEC_DELETION_MARKER_RE.test(prBody ?? "")) {
    return { ok: true, offenders, escape: "marker" };
  }
  if (supersededPaths.length > 0) {
    return { ok: true, offenders, escape: "superseded-transition" };
  }
  return { ok: false, offenders, escape: null };
}

/**
 * Parse `git diff --name-status --find-renames` output into DiffEntry[].
 * Rename/copy lines carry two paths (`R100\told\tnew`); all others one.
 */
export function parseNameStatus(text: string): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0].trim();
    if (!status) continue;
    if (isRenameOrCopy(status)) {
      // R/C: parts = [status, oldPath, newPath]
      if (parts.length >= 3) {
        out.push({ status, oldPath: parts[1], path: parts[2] });
      }
    } else if (parts.length >= 2) {
      out.push({ status, path: parts[1] });
    }
  }
  return out;
}

/** Extract the leading `---`-delimited YAML frontmatter block, or "". */
function frontmatter(text: string): string {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

/**
 * The `git diff --name-status --find-renames <base>...HEAD` output — from the
 * `LINT_DIFF_NAMESTATUS_FILE` seam when set, else the live repo. `<base>`
 * defaults to `origin/main` (override with `LINT_DIFF_BASE`); the three-dot form
 * diffs the PR branch since it diverged from main.
 */
async function readNameStatus(): Promise<string> {
  const seam = process.env.LINT_DIFF_NAMESTATUS_FILE;
  if (seam) {
    return readFileSync(resolve(seam), "utf8");
  }
  const base = process.env.LINT_DIFF_BASE ?? "origin/main";
  const { stdout } = await execa(
    "git",
    ["diff", "--name-status", "--find-renames", `${base}...HEAD`],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

/**
 * Of the modified (or renamed) retireable files in the diff, those whose CURRENT
 * frontmatter carries a Superseded/Retired status — the documented-retirement
 * signal (escape a). Read from the working tree (`LINT_FIXTURE_ROOT` in tests).
 */
async function supersededTransitions(entries: DiffEntry[]): Promise<string[]> {
  const candidates = entries
    .filter(
      (e) =>
        !isDeletion(e.status) &&
        e.status.charAt(0) !== "A" &&
        isRetireablePath(e.path),
    )
    .map((e) => normalize(e.path));
  const hits: string[] = [];
  for (const rel of candidates) {
    try {
      const text = await readFile(resolve(REPO_ROOT, rel), "utf8");
      if (RETIRE_STATUS_RE.test(frontmatter(text))) hits.push(rel);
    } catch {
      // Absent from the tree — cannot confirm a transition; skip.
    }
  }
  return hits;
}

/** PR body via `gh pr view` (with the `PR_BODY` CI override), or "" on failure. */
async function prBody(prNumber: string): Promise<string> {
  const res = await ghViewJson<{ body?: string }>(
    "pr",
    prNumber,
    "body",
    REPO_ROOT,
  );
  if (!res.ok) {
    // Fail-closed: with no body we cannot confirm the marker → the WARN fires.
    info(`could not read PR #${prNumber} body (${res.error}); treating as no marker`);
    return "";
  }
  return res.data.body ?? "";
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }

  let nameStatus: string;
  try {
    nameStatus = await readNameStatus();
  } catch (e) {
    fail(`could not compute the PR diff: ${(e as Error).message.split("\n")[0]}`);
  }
  const entries = parseNameStatus(nameStatus);

  // Fast exit: no retireable deletion at all → rule does not apply (skip the
  // body/tree round-trips entirely).
  const anyDeletion = entries.some(
    (e) => isDeletion(e.status) && isRetireablePath(e.path),
  );
  if (!anyDeletion) {
    info(
      `PR #${prNumber} deletes no spec/ADR file under apps/docs/content/{specs,adr}, rule does not apply`,
    );
    process.exit(0);
  }

  const superseded = await supersededTransitions(entries);
  const body = await prBody(prNumber);
  const verdict = evaluateSpecDeletion(entries, superseded, body);

  if (verdict.ok) {
    if (verdict.escape === "marker") {
      info(
        `PR #${prNumber} deletes ${verdict.offenders.length} spec/ADR file(s) but carries a \`spec-deletion:\` justification marker — sanctioned.`,
      );
    } else if (verdict.escape === "superseded-transition") {
      info(
        `PR #${prNumber} deletes ${verdict.offenders.length} spec/ADR file(s) alongside a Superseded/Retired transition (${superseded.join(", ")}) — sanctioned retirement wave.`,
      );
    }
    process.exit(0);
  }

  for (const f of verdict.offenders) {
    process.stderr.write(`${TAG} deleted spec/ADR file  ${f}\n`);
  }
  fail(
    `${verdict.offenders.length} spec/ADR file(s) DELETED. Specs and ADRs are retired by a ` +
      `\`status: Superseded\` (or \`Retired\`) frontmatter transition, never file removal ` +
      `(AGENTS.md §6 / ADR-0006 §7). If this removal is intentional, either transition the ` +
      `affected file's frontmatter instead of deleting it, or add a ` +
      `\`spec-deletion: <reason + superseding ref>\` line to the PR body. A pure rename ` +
      `(\`git mv\`) is not a deletion and passes. [SEVERITY: ${SEVERITY} — CI job is continue-on-error.]`,
  );
}

// Run only as the entry point so the pure seams import cleanly under the
// guard-test harness without firing `main()`.
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main().catch((e) => {
    process.stderr.write(
      `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
    );
    process.exit(1);
  });
}
