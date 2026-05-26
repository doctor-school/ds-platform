#!/usr/bin/env tsx
/**
 * tools/agent-bootstrap.ts — deterministic session bootstrap.
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §4
 * ADR:  docs/adr/0007-ai-stack-en.md §2.5
 *
 * Prints a ≤ 2 KB markdown snapshot of git + GitHub state + active spec metadata
 * + recommended next step. Used by Claude Code SessionStart hook (pnpm bootstrap),
 * Codex AGENTS.md "Before any task" first step, or manual invocation.
 *
 * Hard rule: NEVER throw an unhandled error. Every failure path returns a
 * printable warning so the SessionStart hook does not crash. Exit code is
 * always 0 (warnings reported in a "Warnings" section).
 */
import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Warn {
  source: string;
  message: string;
}
const warnings: Warn[] = [];

function note(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
  warnings.push({ source, message });
}

interface GitState {
  branch: string;
  clean: boolean;
  recent: string[];
  aheadOfMain: string; // "?" if unknown
}

async function gitState(): Promise<GitState> {
  let branch = '(unknown)';
  let clean = true;
  let recent: string[] = [];
  let aheadOfMain = '?';

  try {
    const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: REPO_ROOT });
    branch = stdout.trim() || '(detached)';
  } catch (e) {
    note('git branch', e);
  }

  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: REPO_ROOT });
    clean = stdout.trim() === '';
  } catch (e) {
    note('git status', e);
  }

  try {
    const { stdout } = await execa('git', ['log', '-5', '--pretty=%h %s'], { cwd: REPO_ROOT });
    recent = stdout.split('\n').filter(Boolean);
  } catch (e) {
    note('git log', e);
  }

  try {
    const { stdout } = await execa('git', ['rev-list', '--count', 'origin/main..HEAD'], {
      cwd: REPO_ROOT,
    });
    aheadOfMain = stdout.trim();
  } catch {
    // origin/main not fetched yet — common on fresh clone / fresh repo.
    aheadOfMain = '?';
  }

  return { branch, clean, recent, aheadOfMain };
}

interface GhIssue {
  number: number;
  title: string;
  labels?: Array<{ name: string }>;
  milestone?: { title: string } | null;
  assignees?: Array<{ login: string }>;
  updatedAt?: string;
  body?: string;
}

interface GhPR {
  number: number;
  title: string;
  reviewDecision?: string | null;
  updatedAt?: string;
  headRefName?: string;
}

async function ghIssues(args: string[]): Promise<GhIssue[]> {
  try {
    const { stdout } = await execa(
      'gh',
      [
        'issue',
        'list',
        ...args,
        '--json',
        'number,title,labels,milestone,assignees,updatedAt,body',
      ],
      { cwd: REPO_ROOT },
    );
    return JSON.parse(stdout) as GhIssue[];
  } catch (e) {
    note(`gh issue list ${args.join(' ')}`, e);
    return [];
  }
}

/** `gh issue list` has no `--no-assignee` flag in all versions — post-filter. */
async function ghUnassignedIssues(args: string[]): Promise<GhIssue[]> {
  const all = await ghIssues(args);
  return all.filter((i) => !i.assignees || i.assignees.length === 0);
}

async function ghPRs(): Promise<GhPR[]> {
  try {
    const { stdout } = await execa(
      'gh',
      [
        'pr',
        'list',
        '--author',
        '@me',
        '--state',
        'open',
        '--json',
        'number,title,reviewDecision,updatedAt,headRefName',
      ],
      { cwd: REPO_ROOT },
    );
    return JSON.parse(stdout) as GhPR[];
  } catch (e) {
    note('gh pr list', e);
    return [];
  }
}

interface SpecMeta {
  status: string;
  adrs: string[];
  terms: string[];
  path: string;
}

async function readSpecMeta(milestoneName: string): Promise<SpecMeta | null> {
  const specDir = resolve(REPO_ROOT, 'apps/docs/content/specs/features', milestoneName);
  const numMatch = milestoneName.match(/^(\d{3})-/);
  if (!numMatch) return null;
  try {
    const raw = await readFile(resolve(specDir, `${numMatch[1]}-requirements.md`), 'utf-8');
    const parsed = matter(raw);
    const content = parsed.content;
    const data = parsed.data as Record<string, unknown>;
    const adrs = Array.from(new Set(content.match(/ADR-\d{4}/g) ?? []));
    const terms = Array.from(
      new Set(
        (content.match(/\[\[([a-z][a-z0-9_-]*)\]\]/g) ?? []).map((m) => m.slice(2, -2)),
      ),
    );
    const status = typeof data['status'] === 'string' ? (data['status'] as string) : 'unknown';
    return { status, adrs, terms, path: specDir };
  } catch {
    // Spec folder does not exist yet (Issue may predate spec creation).
    return null;
  }
}

function recommend(
  activeWorking: GhIssue[],
  awaitingReview: GhIssue[],
  openPRs: GhPR[],
  readyQueue: GhIssue[],
): string {
  if (awaitingReview.length > 0) {
    return `Address review on Issue #${awaitingReview[0]!.number}.`;
  }
  if (openPRs.some((pr) => pr.reviewDecision === 'CHANGES_REQUESTED')) {
    return `You have a PR with CHANGES_REQUESTED — address feedback first.`;
  }
  if (activeWorking.length > 0) {
    return `Resume #${activeWorking[0]!.number} (most recently updated).`;
  }
  if (readyQueue.length > 0) {
    return `No active work. Pick from ready queue: ${readyQueue
      .slice(0, 3)
      .map((i) => `#${i.number}`)
      .join(', ')}.`;
  }
  return `Clean slate. Open a new feature-spec via superpowers:brainstorming.`;
}

function ts(): string {
  // YYYY-MM-DD HH:mm UTC — stable, sortable.
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

async function main(): Promise<void> {
  const [git, working, awaiting, ready, prs] = await Promise.all([
    gitState(),
    ghIssues(['--assignee', '@me', '--label', 'agent-working']),
    ghIssues(['--assignee', '@me', '--label', 'awaiting-review']),
    ghUnassignedIssues(['--label', 'agent-ready', '--limit', '20']).then((rs) => rs.slice(0, 5)),
    ghPRs(),
  ]);

  const activeSpecs = await Promise.all(
    working.map(async (i) => {
      const ms = i.milestone?.title;
      if (!ms) return { issue: i, spec: null as SpecMeta | null };
      return { issue: i, spec: await readSpecMeta(ms) };
    }),
  );

  const out: string[] = [];
  out.push(`# Agent bootstrap — ${ts()} UTC`);
  out.push('');

  out.push('## Git');
  const aheadStr =
    git.aheadOfMain === '?'
      ? '(origin/main unknown)'
      : git.aheadOfMain === '0'
        ? 'in sync with origin/main'
        : `${git.aheadOfMain} ahead of origin/main`;
  out.push(`- Branch: \`${git.branch}\` ${git.clean ? '(clean)' : '(DIRTY)'} — ${aheadStr}`);
  if (git.recent.length > 0) {
    out.push('- Recent commits:');
    for (const c of git.recent) out.push(`  - ${c}`);
  } else {
    out.push('- Recent commits: (none)');
  }
  out.push('');

  out.push('## Issues (working / awaiting / ready)');
  if (working.length === 0 && awaiting.length === 0 && ready.length === 0) {
    out.push('(none)');
  } else {
    for (const i of working) {
      out.push(
        `- working  #${i.number} ${i.title} — milestone: ${i.milestone?.title ?? '(none)'}`,
      );
    }
    for (const i of awaiting) {
      out.push(`- awaiting #${i.number} ${i.title} — review-response needed`);
    }
    for (const i of ready) {
      out.push(`- ready    #${i.number} ${i.title} — milestone: ${i.milestone?.title ?? '(none)'}`);
    }
  }
  out.push('');

  out.push('## PRs');
  if (prs.length === 0) {
    out.push('(none)');
  } else {
    for (const p of prs) {
      out.push(
        `- PR #${p.number} ${p.title} (${p.reviewDecision ?? 'pending'}) branch \`${p.headRefName ?? '?'}\``,
      );
    }
  }
  out.push('');

  out.push('## Active specs');
  const withSpec = activeSpecs.filter((x) => x.spec !== null);
  if (withSpec.length === 0) {
    out.push('(no active spec — start a new one via superpowers:brainstorming)');
  } else {
    for (const { issue, spec } of withSpec) {
      if (!spec) continue;
      const rel = spec.path.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '');
      out.push(`- #${issue.number} → ${rel}`);
      out.push(`  - status: ${spec.status}`);
      out.push(`  - ADRs: ${spec.adrs.join(', ') || '(none cited)'}`);
      out.push(`  - glossary: ${spec.terms.join(', ') || '(none)'}`);
    }
  }
  out.push('');

  out.push('## Recommendation');
  out.push(recommend(working, awaiting, prs, ready));
  out.push('');

  if (warnings.length > 0) {
    out.push('## Warnings');
    for (const w of warnings) {
      out.push(`- ${w.source}: ${w.message}`);
    }
    out.push('');
  }

  process.stdout.write(out.join('\n'));
}

main().catch((e) => {
  // Last-resort guard: must never crash the SessionStart hook.
  process.stderr.write(`[agent-bootstrap] unexpected error: ${String(e)}\n`);
  process.exit(0);
});
