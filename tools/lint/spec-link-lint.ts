#!/usr/bin/env tsx
/**
 * tools/lint/spec-link-lint.ts — BLOCK guard for `feature:*` PRs.
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §5
 * ADR:  apps/docs/content/adr/0007-ai-stack-en.md §2.6 (CI guards surface as
 *       PR checks the human reviewer consumes; no automated reviewer-bot.)
 *
 * Validates that any PR labeled `feature:*`:
 *   1. Has `Closes #N` (or equivalent auto-close keyword) in the body
 *   2. Each linked Issue has a milestone
 *   3. The milestone's spec folder exists: apps/docs/content/specs/features/<title>/
 *   4. <NNN>-requirements.md is present in that folder (NNN = leading number of the milestone title)
 *
 * Non-PR runs and non-feature PRs → exit 0 with skip note.
 * Failures: stderr, exit 1. Success: stdout summary, exit 0.
 */
import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG = '[spec-link]';

// GitHub auto-close keywords (case-insensitive). See:
// https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

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
  try {
    const { stdout } = await execa(
      'gh',
      ['pr', 'view', prNumber, '--json', 'number,title,body,labels'],
      { cwd: REPO_ROOT },
    );
    return JSON.parse(stdout) as GhPR;
  } catch (e) {
    process.stderr.write(`${TAG} gh pr view ${prNumber} failed: ${(e as Error).message.split('\n')[0]}\n`);
    return null;
  }
}

async function ghIssue(num: number): Promise<GhIssue | null> {
  try {
    const { stdout } = await execa(
      'gh',
      ['issue', 'view', String(num), '--json', 'number,title,milestone,body'],
      { cwd: REPO_ROOT },
    );
    return JSON.parse(stdout) as GhIssue;
  } catch (e) {
    process.stderr.write(`${TAG} gh issue view ${num} failed: ${(e as Error).message.split('\n')[0]}\n`);
    return null;
  }
}

function extractClosedIssues(body: string): number[] {
  const out = new Set<number>();
  if (!body) return [];
  for (const m of body.matchAll(CLOSE_RE)) {
    out.add(Number(m[1]));
  }
  return [...out];
}

function specFolderFor(milestoneTitle: string): string {
  // Convention: milestone title IS the folder name (e.g. "042-glossary-mvp").
  // No sanitization — milestone title authoring rules enforce slug-safe names.
  return resolve(REPO_ROOT, 'apps', 'docs', 'content', 'specs', 'features', milestoneTitle);
}

async function main(): Promise<void> {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== 'pull_request') {
    info(`not a pull_request event (GITHUB_EVENT_NAME=${eventName ?? 'unset'}), skipping`);
    process.exit(0);
  }

  // PR number: prefer GitHub Actions context, fall back to gh CLI.
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? '';
  if (!prNumber && process.env.GITHUB_REF) {
    // refs/pull/<N>/merge → <N>
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  if (!prNumber) {
    info('cannot determine PR number from environment, skipping');
    process.exit(0);
  }

  const pr = await ghPR(prNumber);
  if (!pr) fail(`could not fetch PR #${prNumber} metadata`);

  const featureLabels = pr.labels.filter((l) => isFeatureLabel(l.name));
  if (featureLabels.length === 0) {
    info(`PR #${pr.number} has no feature:* label, rule does not apply`);
    process.exit(0);
  }

  info(`PR #${pr.number} labels: ${featureLabels.map((l) => l.name).join(', ')}`);

  const linked = extractClosedIssues(pr.body ?? '');
  if (linked.length === 0) {
    fail(
      `PR #${pr.number} labeled \`${featureLabels[0].name}\` but body has no \`Closes #N\` keyword. Link an Issue.`,
    );
  }

  const failures: string[] = [];
  for (const num of linked) {
    const issue = await ghIssue(num);
    if (!issue) {
      failures.push(`could not fetch Issue #${num}`);
      continue;
    }
    if (!issue.milestone) {
      failures.push(
        `Linked Issue #${num} has no milestone — feature work requires a milestone (NNN-slug).`,
      );
      continue;
    }
    const folder = specFolderFor(issue.milestone.title);
    if (!(await exists(folder))) {
      failures.push(
        `Milestone \`${issue.milestone.title}\` references spec folder \`${folder.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '')}\` which does not exist. Create the spec first via the brainstorming → writing-plans flow.`,
      );
      continue;
    }
    const numMatch = issue.milestone.title.match(/^(\d{3})-/);
    if (!numMatch) {
      failures.push(
        `Milestone \`${issue.milestone.title}\` does not start with a 3-digit prefix (expected \`NNN-<slug>\` per ADR-0006 §4).`,
      );
      continue;
    }
    const reqsFilename = `${numMatch[1]}-requirements.md`;
    const reqs = resolve(folder, reqsFilename);
    if (!(await exists(reqs))) {
      failures.push(
        `Spec folder \`${issue.milestone.title}\` exists but lacks \`${reqsFilename}\`. Cannot validate EARS coverage.`,
      );
      continue;
    }
    info(`Issue #${num} → milestone \`${issue.milestone.title}\` → spec OK`);
  }

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`${TAG} ${f}\n`);
    process.exit(1);
  }

  info(`all ${linked.length} linked Issue(s) validated`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
