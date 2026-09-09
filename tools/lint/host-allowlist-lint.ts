#!/usr/bin/env tsx
/**
 * tools/lint/host-allowlist-lint.ts — the TREE check of the
 * one-code-two-storefronts plan (Issue #2002, tech spec
 * `apps/docs/content/specs/tech/2026-09-07-one-code-two-storefronts-plan-en.md`
 * §3 rule 3, first bullet + «Honest limit» bullet; §5).
 *
 * Why this exists: `cross-front-reuse` asks the PR AUTHOR to declare, in the PR
 * body, which canonical unit a storefront file consumed. A body field is a
 * promise, not a fact — it is written once, by the same person who wrote the
 * duplicate, and it says nothing about the file that quietly appears in a
 * directory nobody listed. Twelve reuse escalations in seven days were all of
 * that shape. This guard replaces the promise with a tree check against a
 * checked-in answer key: the file either has a row in
 * `apps/docs/content/specs/product/two-site-ia/capability-ownership.md` →
 * «Host-file allowlist», or it does not exist as far as the rule is concerned.
 * There is NO path list in this source — the registry is the single answer key,
 * so adding host code and recording the decision are the same edit.
 *
 * What it checks (three classes, each its own finding):
 *   1. TREE — every `apps/{portal,doctor}` `.ts`/`.tsx` file needs an exact-path
 *      row. Exempt: Next.js route files by basename (`page`, `layout`,
 *      `loading`, `error`, `not-found`, `template`, `default`, `route`,
 *      `middleware`, `proxy`), tests (`*.test.*`, `*.spec.*`, `__tests__/**`),
 *      `e2e/**`, ambient `*.d.ts`, and the app's own root-level config files
 *      (depth 1: `next.config.ts`, `playwright.*.config.ts`, `vitest.*`). A
 *      `hooks/` helper, a renamed directory and an `app/**` client component
 *      beside a `page.tsx` are all in scope — those are the bypasses the
 *      `{lib,components}`-only wording left open.
 *   2. DEAD-GLOB SELF-TEST — a row naming a file that no longer exists is a
 *      finding, and so is a row written as a glob (`*`, `?`, `{…}`). Without
 *      both, the answer key rots: stale rows accumulate and one `**` row makes
 *      the tree check vacuously green. Next.js route groups and dynamic
 *      segments are legitimate path characters, not globs.
 *   3. HONEST LIMIT — on a `pull_request` event, a diff touching a file whose
 *      row `until` names an extraction wave is reported with the row quoted, so
 *      growth of a file the wave is about to delete is visible. `permanent`
 *      rows are host-only by decision and never flag. Beyond that, allowlisted
 *      files remain reviewer territory: the claim is «no NEW host file without
 *      a registry event», not «no duplication».
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 — a new guard lands WARN, promotes
 * once stable). The severity lives in the exit code plus the `guards-warn`
 * step's `continue-on-error`; the step is NOT in the `ci` needs-list. #2074
 * promotes it to BLOCK after wave 1 lands and retires `cross-front-reuse` at
 * the same time — that PR-body marker exists only because this tree check did
 * not, so the two must never both be load-bearing.
 *
 * Outside a `pull_request` event class 3 is skipped with an info line; classes
 * 1 and 2 always run (that is what `pnpm pr:preflight --static` executes).
 *
 * Run: `pnpm lint:host-allowlist`. Findings: stderr, exit 1. Clean: stdout
 * summary, exit 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

import { ghViewJson } from "./lib/gh";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at
// a fixture tree (tools/lint/guard-tests). Inert in production — when unset the
// root resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[host-allowlist]";

/** The checked-in answer key, and the heading that opens its allowlist section. */
const REGISTRY_REL =
  "apps/docs/content/specs/product/two-site-ia/capability-ownership.md";
const SECTION_HEADING = "## Host-file allowlist";

/** The two storefront hosts the plan converges; other apps are out of scope. */
const SCAN_GLOBS = [
  "apps/portal/**/*.ts",
  "apps/portal/**/*.tsx",
  "apps/doctor/**/*.ts",
  "apps/doctor/**/*.tsx",
];
const SCAN_IGNORE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/e2e/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.d.ts",
];
const ROUTE_BASENAME_RE =
  /^(page|layout|loading|error|not-found|template|default|route|middleware|proxy)\.tsx?$/;
/** Only true glob metacharacters: route groups and dynamic segments are real path text. */
const GLOB_CHARS_RE = /[*?{}]/;
/** A row is `| <backtick path> | reason | until |`; header and separator rows carry no backticks. */
const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/;
const WAVE_RE = /\bwave\s*\d+/i;

interface Row {
  path: string;
  reason: string;
  until: string;
}

interface GhPR {
  number: number;
  files?: { path: string }[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * Parse the allowlist rows out of the registry. Only the span between
 * `## Host-file allowlist` and the next `## ` heading is read: the `## Registry`
 * table above it uses brace globs in a different column shape and is NOT an
 * allowlist row.
 */
function parseAllowlist(): Row[] {
  const file = resolve(REPO_ROOT, REGISTRY_REL);
  if (!existsSync(file)) fail(`answer key not found at ${REGISTRY_REL}`);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  if (start === -1) {
    fail(`«${SECTION_HEADING}» section missing in ${REGISTRY_REL}`);
  }
  const rows: Row[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    const m = ROW_RE.exec(line.trim());
    if (m) rows.push({ path: m[1].trim(), reason: m[2], until: m[3] });
  }
  return rows;
}

/** Repo-relative posix paths of every host file that must carry a row. */
function scanHostFiles(): string[] {
  return fg
    .sync(SCAN_GLOBS, { cwd: REPO_ROOT, ignore: SCAN_IGNORE })
    .filter((rel) => {
      const parts = rel.split("/");
      // Depth 1 inside the app is the app config surface (next.config.ts,
      // playwright.*.config.ts, vitest.*, orphan-timers.setup.ts): not host
      // composition, and never extracted into a package.
      if (parts.length === 3) return false;
      return !ROUTE_BASENAME_RE.test(parts[parts.length - 1]);
    })
    .sort();
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
 * Class 3 — the honest limit. Returns finding lines, or an empty list when the
 * check does not apply (no pull_request context, or the `gh` read failed).
 */
async function honestLimit(rows: Row[]): Promise<string[]> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), honest-limit check skipped`,
    );
    return [];
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info(
      "cannot determine PR number from environment, honest-limit check skipped",
    );
    return [];
  }
  const res = await ghViewJson<GhPR>("pr", prNumber, "number,files");
  if (!res.ok) {
    process.stderr.write(`${TAG} gh pr view ${prNumber} failed: ${res.error}\n`);
    return [];
  }
  const touched = new Set((res.data.files ?? []).map((f) => f.path));
  return rows
    .filter((r) => touched.has(r.path) && WAVE_RE.test(r.until))
    .map(
      (r) =>
        `${r.path}: PR #${prNumber} grows a file its extraction wave deletes — ` +
        `row: | \`${r.path}\` | ${r.reason} | ${r.until} |`,
    );
}

async function main(): Promise<void> {
  const rows = parseAllowlist();
  const listed = new Set(rows.map((r) => r.path));
  const findings: string[] = [];

  // Class 2 — the answer key checks itself first: a rotten key cannot judge a tree.
  for (const row of rows) {
    if (GLOB_CHARS_RE.test(row.path)) {
      findings.push(
        `glob row \`${row.path}\` — the allowlist takes EXACT repo-relative paths; ` +
          `a pattern makes the tree check vacuously green`,
      );
      continue;
    }
    if (!existsSync(resolve(REPO_ROOT, row.path))) {
      findings.push(
        `stale row \`${row.path}\` — the file no longer exists; the row is deleted by the PR that deletes the file`,
      );
    }
  }

  // Class 1 — the tree check.
  const files = scanHostFiles();
  for (const rel of files) {
    if (!listed.has(rel)) {
      findings.push(
        `${rel}: no allowlist row — add one to ${REGISTRY_REL} under «${SECTION_HEADING}» in THIS PR ` +
          `(reason + the wave that deletes it, or \`permanent\` for a genuinely host-only surface)`,
      );
    }
  }

  // Class 3 — the honest limit.
  findings.push(...(await honestLimit(rows)));

  if (findings.length > 0) {
    process.stderr.write(
      `${TAG} ${findings.length} finding(s) — host files answer to the registry (#2002, tech spec §3 rule 3):\n`,
    );
    for (const f of findings) process.stderr.write(`${TAG}   ${f}\n`);
    process.stderr.write(
      `${TAG} WARN v1 (ADR-0007 §2.6): annotated, not merge-blocking. #2074 promotes this guard to BLOCK ` +
        `after wave 1 and retires the cross-front-reuse PR-body marker it replaces.\n`,
    );
    process.exit(1);
  }

  info(
    `OK — ${files.length} host file(s) under apps/portal + apps/doctor all carry an allowlist row, ` +
      `and all ${rows.length} row(s) name an exact, existing path.`,
  );
  process.exit(0);
}

void main();
