#!/usr/bin/env tsx
/**
 * tools/lint/catalog-deletion-lint.ts — guard: a change must not DELETE files
 * under `apps/docs/content/skills/**` (the project skill catalog) without an
 * explicit intent marker.
 *
 * WHY (Issue #1261). The catalog path IS the dispatch contract every session
 * reads (AGENTS.md §3.3). On Windows `pnpm install` → `pnpm agent:setup`
 * materialises `.agents/skills` as a junction onto that tree; before #1261 git
 * descended into the junction, so `git add -A` staged ~28 phantom paths and any
 * routine unwind (`git reset --hard`, `git stash`, `git checkout -- .`) removed
 * the REAL catalog through the link. It fired on two independent agents in one
 * day (PR #1257 rework, PR #1259); both caught it only by reading their own diff.
 * The `/.agents/skills/**` ignore rule removes that mechanism — this guard is the
 * backstop that keeps the NEXT accidental mass-deletion (any mechanism at all)
 * from reaching a commit or a merge silently.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * Any `git diff --name-status --find-renames` entry with status `D` under
 * `apps/docs/content/skills/` is flagged, UNLESS an explicit intent marker holds:
 *   - PRE-COMMIT mode (`--staged`): the env var `CATALOG_DELETION=<reason>` is
 *     set to a non-empty value.
 *   - PR mode (default): the PR body carries a `catalog-deletion: <reason>` line.
 * A pure MOVE/RENAME (`R`/`C` under `--find-renames`) is not a deletion and never
 * trips the guard — renaming a skill directory passes untouched.
 *
 * ── Two invocations, one rule ─────────────────────────────────────────────────
 * 1. `pnpm lint:catalog-deletion --staged` — runs from the `pre-commit` hook
 *    against the INDEX. This is the loud one: it aborts the commit at the exact
 *    moment the trap fired historically, before anything is pushed.
 * 2. `pnpm lint:catalog-deletion` — PR mode, a step of the `pr-body-guards`
 *    batch. PR-event-gated (exits 0 on any other event) and WARN per the
 *    ADR-0007 §2.6 new-guard posture: its step carries `continue-on-error: true`
 *    and the batch's WARN-report step exits 0, so a finding is visible but never
 *    merge-blocking. TO PROMOTE TO BLOCK: drop `continue-on-error: true` from the
 *    `WARN · catalog-deletion` step of `.github/workflows/pr-body-guards.yml` and
 *    its row from that batch's WARN-report step — the guard code needs no change.
 *    (The pre-commit invocation is already hard-failing; the CI half is the
 *    push-side visibility layer.)
 *
 * ── Seam (pure fn + thin wrapper) ─────────────────────────────────────────────
 * `evaluateCatalogDeletion(entries, intent)` is PURE (unit-tested directly). The
 * wrapper only computes the diff and the intent string. Seams (inert in
 * production): `LINT_DIFF_NAMESTATUS_FILE` serves a canned `--name-status`
 * output; `LINT_FIXTURE_ROOT` relocates the repo root; `LINT_GH_FIXTURE_DIR`
 * (lib/gh.ts) + `PR_BODY` serve the PR body.
 */
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { parseNameStatus, isDeletion, type DiffEntry } from "./spec-deletion-lint";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[catalog-deletion]";

/** SEVERITY — BLOCK at the pre-commit hook, WARN as a CI step (see header). */
export const SEVERITY = "BLOCK (pre-commit) / WARN (CI)" as const;

/** The protected contract surface: the project skill catalog (AGENTS.md §3.3). */
export const CATALOG_PATH_RE = /^apps\/docs\/content\/skills\/.+$/;

/** The explicit body justification marker; requires a non-empty value. */
export const CATALOG_DELETION_MARKER_RE = /^\s*catalog-deletion:\s*\S.*$/im;

export interface Verdict {
  ok: boolean;
  /** Deleted catalog paths (populated whether or not the escape applies). */
  offenders: string[];
  /** Whether an explicit intent marker sanctioned the deletions. */
  escape: "marker" | null;
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isCatalogPath(p: string): boolean {
  return CATALOG_PATH_RE.test(normalize(p));
}

/**
 * PURE core (unit-tested). `intent` is the text searched for the
 * `catalog-deletion: <reason>` marker — the PR body in PR mode, the
 * `CATALOG_DELETION` env value normalised into marker form (`markerFromEnv`) in
 * pre-commit mode.
 */
export function evaluateCatalogDeletion(
  entries: DiffEntry[],
  intent: string,
): Verdict {
  const offenders = entries
    .filter((e) => isDeletion(e.status) && isCatalogPath(e.path))
    .map((e) => normalize(e.path));

  if (offenders.length === 0) return { ok: true, offenders: [], escape: null };
  if (CATALOG_DELETION_MARKER_RE.test(intent ?? "")) {
    return { ok: true, offenders, escape: "marker" };
  }
  return { ok: false, offenders, escape: null };
}

/**
 * Normalise the pre-commit env escape (`CATALOG_DELETION=<reason>`) into the same
 * marker line the PR body carries, so ONE regex decides both modes. An empty or
 * whitespace-only value yields "" and never sanctions anything.
 */
export function markerFromEnv(value: string | undefined): string {
  const reason = (value ?? "").replace(/[\r\n]+/g, " ").trim();
  return reason ? `catalog-deletion: ${reason}` : "";
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

/** The `--name-status` output — from the seam when set, else live git. */
async function readNameStatus(staged: boolean): Promise<string> {
  const seam = process.env.LINT_DIFF_NAMESTATUS_FILE;
  if (seam) return readFileSync(resolve(seam), "utf8");
  const args = staged
    ? ["diff", "--cached", "--name-status", "--find-renames"]
    : [
        "diff",
        "--name-status",
        "--find-renames",
        `${process.env.LINT_DIFF_BASE ?? "origin/main"}...HEAD`,
      ];
  const { stdout } = await execa("git", args, { cwd: REPO_ROOT });
  return stdout;
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
    // Fail-closed: with no body we cannot confirm the marker → the finding fires.
    info(
      `could not read PR #${prNumber} body (${res.error}); treating as no marker`,
    );
    return "";
  }
  return res.data.body ?? "";
}

function report(verdict: Verdict, how: string): never {
  for (const f of verdict.offenders) {
    process.stderr.write(`${TAG} deleted skill-catalog file  ${f}\n`);
  }
  fail(
    `${verdict.offenders.length} skill-catalog file(s) DELETED. ` +
      `\`apps/docs/content/skills/\` is the AGENTS.md §3.3 dispatch contract — it is not ` +
      `mass-deletable by accident (Issue #1261: a Windows \`.agents/skills\` junction let ` +
      `\`git add -A\` + \`git reset --hard\` wipe it twice in one day). If you did NOT mean ` +
      `to delete these, restore them (\`git checkout -- apps/docs/content/skills\`) and ` +
      `re-check your diff. If the removal IS intentional, ${how} A pure rename ` +
      `(\`git mv\`) is not a deletion and passes. [SEVERITY: ${SEVERITY}]`,
  );
}

async function main(): Promise<void> {
  const staged = process.argv.includes("--staged");

  if (staged) {
    const entries = parseNameStatus(await readNameStatus(true));
    const verdict = evaluateCatalogDeletion(
      entries,
      markerFromEnv(process.env.CATALOG_DELETION),
    );
    if (verdict.ok) {
      if (verdict.escape === "marker") {
        info(
          `staged change deletes ${verdict.offenders.length} skill-catalog file(s) with an explicit CATALOG_DELETION reason — sanctioned.`,
        );
      } else {
        info("staged change deletes no skill-catalog file, rule does not apply");
      }
      process.exit(0);
    }
    report(
      verdict,
      "re-run the commit with `CATALOG_DELETION='<reason>' git commit …`.",
    );
  }

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
    nameStatus = await readNameStatus(false);
  } catch (e) {
    fail(
      `could not compute the PR diff: ${(e as Error).message.split("\n")[0]}`,
    );
  }
  const entries = parseNameStatus(nameStatus);
  if (!entries.some((e) => isDeletion(e.status) && isCatalogPath(e.path))) {
    info(
      `PR #${prNumber} deletes no file under apps/docs/content/skills, rule does not apply`,
    );
    process.exit(0);
  }

  const verdict = evaluateCatalogDeletion(entries, await prBody(prNumber));
  if (verdict.ok) {
    info(
      `PR #${prNumber} deletes ${verdict.offenders.length} skill-catalog file(s) but carries a \`catalog-deletion:\` justification marker — sanctioned.`,
    );
    process.exit(0);
  }
  report(
    verdict,
    "add a `catalog-deletion: <reason + replacement ref>` line to the PR body.",
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
