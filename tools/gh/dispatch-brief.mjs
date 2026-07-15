#!/usr/bin/env node
/**
 * tools/gh/dispatch-brief.mjs — low-friction dispatch-brief scaffold (#915).
 *
 * Why: the inline episode with the highest raw mutation count in the #700
 * orchestration retro (`1b3491b4`, 45 lead edits, 357.7K lead context)
 * rejected dispatch on *brief-authoring cost* — "dispatch would require pumping
 * the whole diff into a brief". When authoring a correct brief is more
 * expensive than executing inline, the lead executes inline. This script
 * attacks that cost asymmetry directly: it emits a ready-to-edit dispatch brief
 * pre-filled with the standard skeleton so authoring a *correct* brief is
 * cheaper than doing the work inline.
 *
 * The emitted skeleton is the `feedback_orchestration_brief_full_lint_before_pr`
 * IMPL-brief shape: a worktree-isolation preamble (absolute paths under
 * `.claude/worktrees/<N>`, `cd` + `git rev-parse` self-check, `pnpm install`),
 * the EDIT-FIRST ≤15-tool-call research budget, recon-facts-are-DONE, the gates
 * block (`pnpm pr:preflight --static` + live `pnpm pr:preflight <N>`), a `## PR`
 * block (ONE `gh pr create --body-file`, `Closes #N`, `author:claude`), and a
 * `## Return contract (≤30 lines)` block. It best-effort SEEDS a changed-file /
 * scope list from the Issue body (path-like tokens) and git worktree state.
 *
 * Canon: memory `feedback_orchestration_brief_full_lint_before_pr` (the
 * assembly CHECKLIST the scaffold pre-stamps). Sibling of `dispatch:brief-check`
 * (#757) and `dispatch:probe` (#744) — same architecture: pure, unit-testable
 * helpers + an injectable runner so tests never shell out.
 *
 * Usage:
 *   pnpm dispatch:brief <issue-N>        # markdown brief to stdout
 *
 * Output: plain markdown to stdout, copy-pasteable into an `Agent` dispatch
 * with minimal edits (the `<N>`, issue title, and branch slug filled in).
 * Best-effort seeding degrades gracefully: if `gh` or the worktree is absent,
 * the corresponding section carries a `<fill …>` placeholder instead of failing.
 *
 * Exit codes: 0 = brief emitted (even with degraded seeding); 2 = usage error
 * (missing or non-numeric <N>).
 *
 * Pure node, no bash-isms — runs on Windows/PowerShell and POSIX alike. The
 * scaffolding logic is exported for unit tests; the `gh`/`git` calls go through
 * an injectable runner so tests never shell out.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Slugify an Issue title into a branch slug (mirrors the repo's existing branch
 * names, e.g. `tooling(agents): low-friction …` → `tooling-agents-low-friction-…`).
 * Lowercase, non-alphanumeric runs → `-`, trimmed, capped to ~6 words so the
 * branch name stays short.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  const words = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean);
  return words.slice(0, 6).join("-") || "task";
}

/**
 * Derive the branch prefix from a conventional-commit-style title
 * (`tooling(agents): …` → `tooling`) or the Issue labels, defaulting to
 * `chore`. Only the canonical prefixes (repo-conventions.md) are honoured.
 * @param {string} title
 * @param {string[]} labels
 * @returns {string}
 */
export function deriveBranchPrefix(title, labels = []) {
  const canonical = new Set([
    "feat",
    "fix",
    "chore",
    "refactor",
    "docs",
    "tooling",
  ]);
  const m = String(title).match(/^([a-z]+)(?:\([^)]*\))?\s*:/i);
  if (m && canonical.has(m[1].toLowerCase())) return m[1].toLowerCase();
  // Label → prefix (label kinds map onto branch prefixes; `feature` → `feat`).
  const labelMap = {
    feature: "feat",
    bug: "fix",
    chore: "chore",
    refactor: "refactor",
    docs: "docs",
    tooling: "tooling",
  };
  for (const l of labels) {
    const p = labelMap[String(l).toLowerCase()];
    if (p) return p;
  }
  return "chore";
}

/**
 * Extract deduped repo-path-like tokens from text (same heuristic as
 * `dispatch-brief-check.extractPathTokens`): a candidate `(?:seg/)+seg` is kept
 * only if its final segment has a file extension OR it contains ≥2 `/`
 * separators — dropping prose like `and/or` and bare `tools/`.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathTokens(text) {
  const out = [];
  const seen = new Set();
  const candidateRe = /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g;
  for (const m of String(text).matchAll(candidateRe)) {
    let tok = m[0].replace(/^[`('"<[]+/, "").replace(/[`)'">\].,;:]+$/, "");
    if (!tok) continue;
    const slashes = (tok.match(/\//g) ?? []).length;
    const hasExt = /\.[A-Za-z0-9]+$/.test(tok.split("/").pop() ?? "");
    if (!hasExt && slashes < 2) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** Default runner — real `gh`/`git` via spawnSync (Windows-safe: both are exes on PATH). */
export function defaultRunner() {
  const run = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
    if (res.error) return { status: 1, stdout: "", stderr: res.error.message };
    return {
      status: res.status ?? 1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  };
  return {
    gh: (args) => run("gh", args),
    git: (args) => run("git", args),
  };
}

/**
 * Best-effort gather of the Issue + git state used to seed the brief. Never
 * throws: a `gh`/`git` failure yields `null`/`[]` fields the renderer degrades on.
 * @param {{issueNumber: string|number, runner: {gh: Function, git: Function}, worktreeExists?: boolean}} args
 * @returns {{title: string|null, body: string, labels: string[], seededFiles: string[], worktreeChanged: string[], branch: string|null}}
 */
export function gatherState({ issueNumber, runner, worktreeExists }) {
  let title = null;
  let body = "";
  let labels = [];
  const res = runner.gh([
    "issue",
    "view",
    String(issueNumber),
    "--json",
    "title,body,labels",
  ]);
  if (res.status === 0) {
    try {
      const j = JSON.parse(res.stdout);
      title = j.title ?? null;
      body = String(j.body ?? "");
      labels = Array.isArray(j.labels)
        ? j.labels.map((l) => l.name ?? l).filter(Boolean)
        : [];
    } catch {
      /* degrade: leave defaults */
    }
  }

  const seededFiles = extractPathTokens(body);

  // Seed changed files from the worktree diff against origin/main, if present.
  let worktreeChanged = [];
  const wt = `.claude/worktrees/${issueNumber}`;
  if (worktreeExists) {
    const d = runner.git([
      "-C",
      wt,
      "diff",
      "--name-only",
      "origin/main...HEAD",
    ]);
    if (d.status === 0) {
      worktreeChanged = d.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  }

  return { title, body, labels, seededFiles, worktreeChanged, branch: null };
}

/** Render a markdown bullet list, or a single `<fill …>` placeholder when empty. */
function bulletsOrPlaceholder(items, placeholder) {
  if (!items || items.length === 0) return `- <fill: ${placeholder}>`;
  return items.map((i) => `- \`${i}\``).join("\n");
}

/**
 * Render the ready-to-edit dispatch brief. Pure — all state is passed in, so the
 * unit test drives it with fixtures.
 * @param {{issueNumber: string|number, title: string|null, labels?: string[], seededFiles?: string[], worktreeChanged?: string[]}} args
 * @returns {string}
 */
export function renderBrief({
  issueNumber,
  title,
  labels = [],
  seededFiles = [],
  worktreeChanged = [],
}) {
  const n = String(issueNumber);
  const displayTitle = title || `<fill: Issue #${n} title>`;
  const prefix = deriveBranchPrefix(title || "", labels);
  const slug = title ? slugify(title) : "<fill-slug>";
  const branch = `${prefix}/${n}-${slug}`;
  const wt = `.claude/worktrees/${n}`;

  // Prefer the worktree diff (concrete changed files); fall back to Issue path-tokens.
  const scopeSource =
    worktreeChanged.length > 0 ? worktreeChanged : seededFiles;
  const scopeLabel =
    worktreeChanged.length > 0
      ? "seeded from the worktree diff (origin/main...HEAD)"
      : "seeded from the Issue body path-tokens";

  return `# IMPL brief — Issue #${n} (${displayTitle})

kind: <fill: feature-iteration | hotfix-pr | adr-revision | engineering-task | …>. Governing skill: <fill \`apps/docs/content/skills/<name>/SKILL.md\`, or declare \`kind: engineering-task\` (AGENTS.md §3.8) if none>.

## Worktree isolation (MANDATORY — read first)
You CANNOT \`EnterWorktree\` (cwd is pinned to the repo root; the tool refuses to switch). Operate EXCLUSIVELY via absolute paths under \`C:/Users/sidor/repos/ds-platform/${wt}\`.
- FIRST action: \`cd C:/Users/sidor/repos/ds-platform/${wt}\`, run \`git rev-parse --show-toplevel\`, confirm it is the worktree root BEFORE any edit. \`pnpm install\` in the worktree before any test.
- Every edited path is absolute under \`${wt}\`. Never touch the shared main tree.
- Branch: \`${branch}\`.

## Research budget
EDIT-FIRST: ≤15 tool calls before your first file edit. Recon facts below are DONE — do not re-verify handed facts. Hitting the cap without editing = STOP + return a partial verdict + what blocked you.

## Recon facts (authoritative — do not re-verify)
- <fill: the DONE facts the subagent needs — sibling scripts to mirror, exact file locations, wiring points. Hand these as facts; never write "re-read the cited files yourself".>

## Deliverable / scope (${scopeLabel})
${bulletsOrPlaceholder(scopeSource, "the files/surfaces this slice touches — each is in-slice or a named, tracked exclusion")}
- <fill: the concrete deliverable — what to build/change, and its acceptance.>

## Gates (all GREEN before push, from the worktree)
- \`pnpm pr:preflight --static\` GREEN before push (runs the STATIC_GUARDS tree-scan family: \`ears-naming\`, \`no-stub\`, …).
- Any red guard touching your NEW files is yours to root-cause — "pre-existing" requires proving it reproduces on \`origin/main\` untouched.
- <fill: task-specific gates — smoke-run, \`pnpm lint:instruction-budget\` if editing an always-on doc, targeted \`pnpm --filter <pkg> test\`, etc.>

## PR
- Commit (\`${prefix}:\`). \`--no-verify\` ⇒ a one-line \`Pre-commit note:\` with the reason in the PR body at create.
- ONE \`gh pr create --body-file\` call, FULL body: \`Closes #${n}\`, kind label \`${prefix === "feat" ? "feature" : prefix}\`, \`author:claude\` in the body, one-line summary. <fill: for a UI-touch PR add the real \`registry-research:\` verdict + a \`## Product note (RU)\`.>
- Immediately after \`gh pr create\`, run \`pnpm pr:preflight <PR#>\` (live PR — fires the 4 PR-event-gated guards \`--static\` skips); report the verdict.
- Do NOT self-review or merge.

## Return contract (≤30 lines)
Line 1: PR # + branch. Then: files changed, gate verdicts (\`pr:preflight --static\`, live \`pr:preflight <N>\`, any task-specific gate), deviations. Heavy detail (full reports, transcripts, DOM dumps) → the PR body or a file, never the reply.

---
Before dispatch, run this brief through the assembly CHECKLIST in memory \`feedback_orchestration_brief_full_lint_before_pr\` (## Dispatch-brief assembly CHECKLIST) and \`pnpm dispatch:brief-check ${n} <this-file>\` (asserts named surfaces ⊇ the Issue's Acceptance-criteria path-tokens + a governing-skill/engineering-task declaration).
`;
}

function usage() {
  process.stderr.write("Usage: pnpm dispatch:brief <issue-N>\n");
  process.exit(2);
}

function main() {
  const issueArg = process.argv[2];
  if (!issueArg || !/^\d+$/.test(issueArg)) usage();

  const runner = defaultRunner();
  const worktreeExists = existsSync(`.claude/worktrees/${issueArg}`);
  const state = gatherState({ issueNumber: issueArg, runner, worktreeExists });

  if (!state.title) {
    process.stderr.write(
      `[dispatch:brief] warning: could not read Issue #${issueArg} via gh — emitting a skeleton with <fill …> placeholders.\n`,
    );
  }

  process.stdout.write(
    renderBrief({
      issueNumber: issueArg,
      title: state.title,
      labels: state.labels,
      seededFiles: state.seededFiles,
      worktreeChanged: state.worktreeChanged,
    }),
  );
  process.exit(0);
}

// Run main only when invoked directly, so the pure helpers can be imported in
// tests. `pathToFileURL` yields canonical `file:///C:/…` on Windows too.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
