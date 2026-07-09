#!/usr/bin/env tsx
/**
 * tools/lint/stage-b-lint.ts — pre-merge Stage-B gate (#692).
 *
 * Why this exists: AGENTS.md §6 ("UI design is approved before it's built — and
 * re-confirmed live before merge") requires that, for a `user-facing` surface,
 * the rendered result is re-confirmed by the product owner on the LIVE stand
 * before merge, and "an unanswered Stage-B approval question BLOCKS the merge".
 * Until now that rule was passive prose — nothing mechanically prevented a
 * user-facing PR from merging without the Stage-B record. It happened: the 006
 * webinar-room slice (PR #691) — new visible room-header chrome — merged to
 * `main` with NO recorded owner Stage-B GO, caught only retroactively in the
 * next session. This guard makes the rule fire.
 *
 * What it checks: if the PR's diff touches a user-facing render surface, the PR
 * body OR a comment on a linked (`Closes #N`) Issue MUST carry an explicit
 * Stage-B marker in one of the two sanctioned shapes (AGENTS.md §6):
 *   - `Stage-B: GO`  (optionally with owner / date), OR
 *   - `Stage-B: batched at #<gate>`  (the batched-Stage-B carve-out).
 * A missing marker, or a placeholder value (`TBD`, `pending`, …), fails.
 *
 * User-facing surface detection (deterministic, by touched path — the Mode-a
 * "classified by touched surface, not the GitHub label" rule,
 * request-mode-a-review §Scope):
 *   - PRIMARY: the diff touches non-exempt render code under `apps/portal/**`
 *     or `apps/admin/**` (the product surfaces the owner reviews live).
 *   - FRONTMATTER HEURISTIC: the diff touches non-exempt render code under
 *     `packages/design-system/**` AND a linked `feature:NNN-<slug>` label
 *     resolves to a spec whose `NNN-requirements.md` frontmatter is
 *     `surface: user-facing` (a DS change shipped as part of a user-facing
 *     feature changes what the owner sees). A DS change tied to no user-facing
 *     spec, and every backend-only / docs / test / generated PR, is exempt.
 *
 * Carve-outs (mirror the `request-mode-a-review` scope carve-outs): pure docs
 * (`*.md`/`*.mdx`, `apps/docs/**`), test-only (`*.spec.*`/`*.test.*`/`e2e/`),
 * config/generated (`*.config.*`, `*.setup.*`, tokens), and backend-only PRs
 * carry no rendered surface → exempt.
 *
 * Severity: WARN-first per ADR-0007 §2.6 (new AI-specific guards land as WARN,
 * promote to BLOCK once stable). The guard itself always exits non-zero on a
 * violation (like every guard); the WARN-vs-BLOCK policy is applied by the
 * runner: `pnpm pr:preflight <N> --pre-merge` treats it as a HARD gate (this is
 * the mechanical pre-merge check), while a plain `pnpm pr:preflight <N>` at
 * create-time reports it as informational (the Stage-B GO is recorded later,
 * right before merge — a create-time hard-fail would be a false red). Promotion
 * to a CI BLOCK job: once it has run clean across the next user-facing PRs with
 * no false positive.
 *
 * Non-PR runs, and PRs that touch no user-facing surface → exit 0 with a skip
 * note. Failures: stderr, exit 1. Success: stdout summary, exit 0.
 *
 * Run: `pnpm lint:stage-b` (PR_NUMBER from the Actions context) or via
 * `pnpm pr:preflight <N> --pre-merge`.
 */
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";

const TAG = "[stage-b]";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the spec-folder reads at a fixture tree
// (the `gh` calls have their own `LINT_GH_FIXTURE_DIR` seam in lib/gh.ts). Inert
// in production — when unset the root resolves to the repo root exactly as
// before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Product render surfaces the owner reviews live. A non-exempt touch here always
// triggers the gate.
const PRODUCT_UI_RE = /^(apps\/portal\/|apps\/admin\/)/;
// The design-system package: a render touch here triggers only when the linked
// spec is `surface: user-facing` (the frontmatter heuristic below).
const DS_RE = /^packages\/design-system\//;

// Non-render files inside those trees that must NOT trip the gate on their own —
// mirrors the `registry-research` exempt set (docs, tests, config, generated
// tokens, e2e support). If a PR ONLY touches these, no Stage-B record is
// required. See registry-research-lint.ts for the per-pattern rationale.
const EXEMPT_RE =
  /(\.md$|\.mdx$|\.json$|\.css$|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|\/__tests__\/|(^|\/)e2e\/|\.config\.[mc]?[tj]s$|\.setup\.[mc]?[tj]sx?$|\/styles\/tokens\.css$|allowed-tokens\.json$)/;

// `feature:NNN-<slug>` area label → the slug IS the spec folder name (mirrors
// spec-link-lint.ts FEATURE_AREA_RE).
const FEATURE_AREA_RE = /^feature:(\d{3}-[a-z0-9][a-z0-9-]*)$/i;

// The Stage-B marker line, scanned across a body / comment (global + multiline).
// Accepts leading blockquote / list / whitespace decoration, and `Stage-B` /
// `StageB` casing.
const MARKER_RE = /^[ \t>*_-]*stage-?b\s*:\s*(.+?)\s*$/gim;
// A marker VALUE is evidence only in the two sanctioned shapes.
const GO_RE = /^go\b/i; // `GO`, `GO — owner 2026-07-09`, …
const BATCHED_RE = /^batched\s+at\s+#\d+/i; // `batched at #700`

interface GhLabel {
  name: string;
}
interface GhPR {
  number: number;
  body: string;
  labels?: GhLabel[];
  files?: { path: string }[];
}
interface GhComment {
  body: string;
}
interface GhIssue {
  number: number;
  comments?: GhComment[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

async function ghPR(prNumber: string): Promise<GhPR | null> {
  const res = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,body,labels,files",
    REPO_ROOT,
  );
  if (!res.ok) {
    process.stderr.write(`${TAG} gh pr view ${prNumber} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

async function ghIssue(num: number): Promise<GhIssue | null> {
  const res = await ghViewJson<GhIssue>("issue", num, "number,comments", REPO_ROOT);
  if (!res.ok) {
    process.stderr.write(`${TAG} gh issue view ${num} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

// GitHub auto-close keywords (case-insensitive), mirrors spec-link-lint.ts.
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
function extractClosedIssues(body: string): number[] {
  const out = new Set<number>();
  if (!body) return [];
  for (const m of body.matchAll(CLOSE_RE)) out.add(Number(m[1]));
  return [...out];
}

/**
 * Extract every Stage-B marker VALUE from a text blob (body or comment). Returns
 * the raw values; classification into GO / batched / invalid happens in the
 * caller so a placeholder marker can be distinguished from a missing one.
 */
function extractMarkerValues(text: string): string[] {
  const values: string[] = [];
  if (!text) return values;
  for (const m of text.matchAll(MARKER_RE)) {
    values.push((m[1] ?? "").trim());
  }
  return values;
}

function isEvidence(value: string): boolean {
  return GO_RE.test(value) || BATCHED_RE.test(value);
}

/**
 * Read a linked feature spec's `surface:` frontmatter value. Resolves the spec
 * folder from the `feature:NNN-<slug>` label (like spec-link-lint.ts), reads
 * `NNN-requirements.md` or `-en`, and pulls `surface:` from the leading YAML
 * frontmatter block. Returns the value (e.g. `user-facing`) or null if the label
 * is not a feature area label, the folder/file is absent, or no `surface:` key.
 */
async function specSurfaceForLabel(labelName: string): Promise<string | null> {
  const m = labelName.match(FEATURE_AREA_RE);
  if (!m) return null;
  const slug = m[1];
  const nnn = slug.slice(0, 3);
  const folder = resolve(
    REPO_ROOT,
    "apps",
    "docs",
    "content",
    "specs",
    "features",
    slug,
  );
  for (const file of [`${nnn}-requirements.md`, `${nnn}-requirements-en.md`]) {
    const path = resolve(folder, file);
    if (!(await exists(path))) continue;
    const text = readFileSync(path, "utf8");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return null;
    const surface = fm[1].match(/^surface:\s*(\S+)/m);
    return surface ? surface[1].trim() : null;
  }
  return null;
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
  const pr = await ghPR(prNumber);
  if (!pr) fail(`could not fetch PR #${prNumber} metadata`);

  const files = (pr.files ?? []).map((f) => f.path);
  const renderable = (re: RegExp) =>
    files.filter((p) => re.test(p) && !EXEMPT_RE.test(p));
  const productFiles = renderable(PRODUCT_UI_RE);
  const dsFiles = renderable(DS_RE);

  // Frontmatter heuristic: a DS-only render change is user-facing only when a
  // linked feature spec is `surface: user-facing`.
  let specUserFacing = false;
  let specNote = "";
  if (productFiles.length === 0 && dsFiles.length > 0) {
    for (const label of pr.labels ?? []) {
      const surface = await specSurfaceForLabel(label.name);
      if (surface === "user-facing") {
        specUserFacing = true;
        specNote = ` (linked spec ${label.name} is surface: user-facing)`;
        break;
      }
    }
  }

  const isUserFacing =
    productFiles.length > 0 || (dsFiles.length > 0 && specUserFacing);

  if (!isUserFacing) {
    info(
      `PR #${pr.number} touches no user-facing render surface (apps/portal|admin, or a design-system change under a user-facing spec), rule does not apply`,
    );
    process.exit(0);
  }

  const trigger =
    productFiles.length > 0
      ? `${productFiles.length} product UI file(s), e.g. ${productFiles.slice(0, 3).join(", ")}`
      : `${dsFiles.length} design-system render file(s)${specNote}`;
  info(`PR #${pr.number} is user-facing: ${trigger}`);

  // Collect marker values from the PR body + every linked-Issue comment.
  const markerValues: string[] = [...extractMarkerValues(pr.body ?? "")];
  const linked = extractClosedIssues(pr.body ?? "");
  for (const num of linked) {
    const issue = await ghIssue(num);
    if (!issue) continue; // a fetch failure on ONE linked issue is not evidence
    for (const c of issue.comments ?? []) {
      markerValues.push(...extractMarkerValues(c.body ?? ""));
    }
  }

  const evidence = markerValues.find(isEvidence);
  if (evidence) {
    info(`Stage-B record OK: "${evidence.slice(0, 80)}"`);
    process.exit(0);
  }

  if (markerValues.length > 0) {
    fail(
      `PR #${pr.number} is user-facing and carries a Stage-B marker whose value is not a Stage-B GO/batched record: ` +
        `"${markerValues[0].slice(0, 60)}". Record the product-owner live verdict as one of:\n` +
        `    Stage-B: GO — <owner, date>\n` +
        `  or, under a batched-gate epic (AGENTS.md §6 carve-out):\n` +
        `    Stage-B: batched at #<gate>`,
    );
  }
  fail(
    `PR #${pr.number} touches a user-facing surface but records no product-owner Stage-B verdict. ` +
      `AGENTS.md §6: the rendered result is re-confirmed by the owner on the LIVE stand before merge — ` +
      `an unanswered Stage-B question BLOCKS the merge. Add to the PR body (or a linked-Issue comment):\n` +
      `    Stage-B: GO — <owner, date>\n` +
      `  or, under a batched-gate epic (AGENTS.md §6 carve-out):\n` +
      `    Stage-B: batched at #<gate>`,
  );
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
