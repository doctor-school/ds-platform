#!/usr/bin/env tsx
/**
 * tools/lint/spec-link-lint.ts — BLOCK guard for `feature:*` PRs.
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §5
 * ADR:  apps/docs/content/adr/0007-ai-stack-design-en.md §2.6 (CI guards surface
 *       as PR checks the human reviewer consumes; no automated reviewer-bot.)
 *
 * Milestone model (AGENTS.md §2): a Milestone is a long-lived **product theme**
 * (e.g. `Auth foundations v1`) that spans multiple specs — it is NOT a spec
 * folder. The spec folder a feature PR implements is carried by the
 * `feature:NNN-<slug>` area label, not by the milestone title.
 *
 * Validates that any PR labeled `feature:NNN-<slug>`:
 *   1. Has `Closes #N` (or equivalent auto-close keyword) in the body.
 *   2. Each linked Issue carries a milestone (the product theme — any title;
 *      grouping for execution state, ADR-0006 §9). Presence only; the title is
 *      not interpreted as a path.
 *   3. The area label resolves to a slug `NNN-<slug>` and the spec folder
 *      `apps/docs/content/specs/features/NNN-<slug>/` exists.
 *   4. That folder contains `NNN-requirements.md` OR `NNN-requirements-en.md`
 *      (product specs use the bilingual `-en`/`-ru` split).
 *
 * Non-PR runs and non-feature PRs → exit 0 with skip note.
 * Failures: stderr, exit 1. Success: stdout summary, exit 0.
 */
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the spec-folder existence checks at a
// fixture tree (the `gh` calls have their own `LINT_GH_FIXTURE_DIR` seam in
// lib/gh.ts). Inert in production — when unset the root resolves to the repo
// root exactly as before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[spec-link]";

// GitHub auto-close keywords (case-insensitive). See:
// https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

// `feature:NNN-<slug>` area label → the slug IS the spec folder name. The bare
// `feature` kind label (no colon) does not match and is ignored here.
const FEATURE_AREA_RE = /^feature:(\d{3}-[a-z0-9][a-z0-9-]*)$/i;

interface GhLabel {
  name: string;
}
interface GhPR {
  number: number;
  title: string;
  body: string;
  labels: GhLabel[];
}
interface GhMilestone {
  title: string;
}
interface GhIssue {
  number: number;
  title: string;
  milestone: GhMilestone | null;
  body: string;
}

function isFeatureLabel(name: string): boolean {
  return /^feature:/i.test(name);
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

async function ghPR(prNumber: string): Promise<GhPR | null> {
  const res = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,title,body,labels",
    REPO_ROOT,
  );
  if (!res.ok) {
    process.stderr.write(`${TAG} gh pr view ${prNumber} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

async function ghIssue(num: number): Promise<GhIssue | null> {
  const res = await ghViewJson<GhIssue>(
    "issue",
    num,
    "number,title,milestone,body",
    REPO_ROOT,
  );
  if (!res.ok) {
    process.stderr.write(`${TAG} gh issue view ${num} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

function extractClosedIssues(body: string): number[] {
  const out = new Set<number>();
  if (!body) return [];
  for (const m of body.matchAll(CLOSE_RE)) {
    out.add(Number(m[1]));
  }
  return [...out];
}

function specFolderForSlug(slug: string): string {
  // The `feature:NNN-<slug>` area label carries the spec folder name directly.
  // No sanitization — the label authoring rule (ADR-0006 §9) enforces the
  // slug-safe `NNN-<slug>` shape, re-checked by FEATURE_AREA_RE at the call site.
  return resolve(
    REPO_ROOT,
    "apps",
    "docs",
    "content",
    "specs",
    "features",
    slug,
  );
}

async function main(): Promise<void> {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${eventName ?? "unset"}), skipping`,
    );
    process.exit(0);
  }

  // PR number: prefer GitHub Actions context, fall back to gh CLI.
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    // refs/pull/<N>/merge → <N>
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }

  const pr = await ghPR(prNumber);
  if (!pr) fail(`could not fetch PR #${prNumber} metadata`);

  const featureLabels = pr.labels.filter((l) => isFeatureLabel(l.name));
  if (featureLabels.length === 0) {
    info(`PR #${pr.number} has no feature:* label, rule does not apply`);
    process.exit(0);
  }

  info(
    `PR #${pr.number} labels: ${featureLabels.map((l) => l.name).join(", ")}`,
  );

  const failures: string[] = [];

  // 1. + 2. — `Closes #N`, and each linked Issue carries a (product-theme) milestone.
  const linked = extractClosedIssues(pr.body ?? "");
  if (linked.length === 0) {
    fail(
      `PR #${pr.number} labeled \`${featureLabels[0].name}\` but body has no \`Closes #N\` keyword. Link an Issue.`,
    );
  }
  for (const num of linked) {
    const issue = await ghIssue(num);
    if (!issue) {
      failures.push(`could not fetch Issue #${num}`);
      continue;
    }
    if (!issue.milestone) {
      failures.push(
        `Linked Issue #${num} has no milestone — feature work must sit under a product-theme milestone (AGENTS.md §2 / ADR-0006 §9).`,
      );
      continue;
    }
    info(
      `Issue #${num} → milestone \`${issue.milestone.title}\` (product theme) OK`,
    );
  }

  // 3. + 4. — each `feature:NNN-<slug>` area label resolves to an existing spec
  // folder with a requirements file. The slug is the spec folder name.
  for (const label of featureLabels) {
    const m = label.name.match(FEATURE_AREA_RE);
    if (!m) {
      failures.push(
        `Label \`${label.name}\` is not a valid \`feature:NNN-<slug>\` area label (expected a 3-digit prefix per ADR-0006 §4).`,
      );
      continue;
    }
    const slug = m[1];
    const folder = specFolderForSlug(slug);
    const rel = folder
      .replace(REPO_ROOT + "\\", "")
      .replace(REPO_ROOT + "/", "");
    if (!(await exists(folder))) {
      failures.push(
        `Label \`${label.name}\` references spec folder \`${rel}\` which does not exist. Author the spec first (superpowers:brainstorming → SDD triplet).`,
      );
      continue;
    }
    const nnn = slug.slice(0, 3);
    const reqsCandidates = [
      `${nnn}-requirements.md`,
      `${nnn}-requirements-en.md`,
    ];
    const found = await Promise.all(
      reqsCandidates.map((f) => exists(resolve(folder, f))),
    );
    if (!found.some(Boolean)) {
      failures.push(
        `Spec folder \`${rel}\` exists but lacks \`${nnn}-requirements.md\` (or \`${nnn}-requirements-en.md\`). Cannot validate EARS coverage.`,
      );
      continue;
    }
    info(`Label \`${label.name}\` → spec \`${rel}\` OK`);
  }

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`${TAG} ${f}\n`);
    process.exit(1);
  }

  info(
    `all ${linked.length} linked Issue(s) + ${featureLabels.length} feature label(s) validated`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
