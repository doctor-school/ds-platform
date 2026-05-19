/**
 * packages/llm-utils/buildContext.ts — shared LLM context helper.
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §7.2
 * ADR:  docs/adr/0007-ai-stack-en.md §2.9 (prompt-caching tiers)
 *
 * Two entry points:
 *
 *   buildSystemBlocks(input)  → canonical 4-tier cached block array for
 *                               Anthropic Messages API / OpenAI prefix cache.
 *                               Used by reviewer-agent + future runtime LLM
 *                               clients. Stable prefix order:
 *                               tier 1: AGENTS.md + CLAUDE.md
 *                               tier 2: active spec (req+design+scenarios)
 *                               tier 3: ADRs (sorted by number)
 *                               tier 4: glossary (no cache marker — volatile)
 *
 *   buildContext(opts)        → string-returning convenience for ad-hoc
 *                               prompts (logs, eval scripts). Same source
 *                               files, flat concat with section headers,
 *                               byte-budget-capped (~80 KB).
 *
 * File-read is fail-soft: missing files log a stderr warning and are skipped.
 * Glossary files may not exist yet (populated in later groups); ADRs may not
 * have been migrated yet. The helper must not throw on absence.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';

const REPO_ROOT = process.env['REPO_ROOT'] ?? process.cwd();
const BYTE_BUDGET = 80 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextInput {
  /** e.g. "apps/docs/content/specs/features/001-doctor-onboarding" (repo-relative). */
  specPath?: string;
  /** e.g. ["ADR-0001", "ADR-0007"]. Sorted internally for cache stability. */
  adrs?: string[];
  /** canonical glossary term IDs, e.g. ["nmo-credit"]. */
  glossaryTerms?: string[];
}

export interface CachedBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface BuildContextOpts {
  /** Free-form task description appended at the end of the context blob. */
  task: string;
  /** ADR IDs (e.g. "0007") or full IDs ("ADR-0007"). */
  relevantAdrs?: string[];
  /** Glossary term IDs. */
  glossaryTerms?: string[];
  /** Repo-relative paths of additional files to inline verbatim. */
  extraFiles?: string[];
  /** Override REPO_ROOT (mostly for tests). */
  repoRoot?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readOptional(absPath: string, label: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf-8');
  } catch {
    process.stderr.write(`[buildContext] WARN: ${label} not readable at ${absPath} — skipping.\n`);
    return null;
  }
}

function normalizeAdrId(a: string): string {
  return a.replace(/^ADR-?/i, '').padStart(4, '0');
}

async function findAdrFile(adrId: string, repoRoot: string): Promise<string | null> {
  const num = normalizeAdrId(adrId);
  const matches = await fg(`docs/adr/${num}-*.md`, { cwd: repoRoot, absolute: true });
  return matches[0] ?? null;
}

// ---------------------------------------------------------------------------
// Canonical API — 4-tier cached blocks (per design spec §7.2)
// ---------------------------------------------------------------------------

export async function buildSystemBlocks(input: ContextInput): Promise<CachedBlock[]> {
  const blocks: CachedBlock[] = [];

  // Tier 1: constitution
  const agentsPath = resolve(REPO_ROOT, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    throw new Error(
      `AGENTS.md not found at ${agentsPath}. Set REPO_ROOT env var to the repo root.`,
    );
  }
  const agentsMd = await readFile(agentsPath, 'utf-8');
  const claudeMd = await readOptional(resolve(REPO_ROOT, 'CLAUDE.md'), 'CLAUDE.md');
  blocks.push({
    type: 'text',
    text:
      `# AGENTS.md\n\n${agentsMd}` +
      (claudeMd ? `\n\n---\n\n# CLAUDE.md\n\n${claudeMd}` : ''),
    cache_control: { type: 'ephemeral' }, // breakpoint 1/4
  });

  // Tier 2: active spec (3 files)
  if (input.specPath) {
    const parts: string[] = [];
    for (const f of ['requirements.md', 'design.md', 'scenarios.feature']) {
      const c = await readOptional(resolve(REPO_ROOT, input.specPath, f), `spec/${f}`);
      if (c) parts.push(`# ${f}\n\n${c}`);
    }
    if (parts.length > 0) {
      blocks.push({
        type: 'text',
        text: parts.join('\n\n---\n\n'),
        cache_control: { type: 'ephemeral' }, // breakpoint 2/4
      });
    }
  }

  // Tier 3: ADRs (sorted by number for byte-stable prefix)
  const adrs = [...(input.adrs ?? [])].sort();
  if (adrs.length > 0) {
    const parts: string[] = [];
    for (const a of adrs) {
      const file = await findAdrFile(a, REPO_ROOT);
      if (file) {
        parts.push(await readFile(file, 'utf-8'));
      } else {
        process.stderr.write(
          `[buildContext] WARN: cited ${a} not found at docs/adr/${normalizeAdrId(a)}-*.md — proceeding without it.\n`,
        );
      }
    }
    if (parts.length > 0) {
      blocks.push({
        type: 'text',
        text: parts.join('\n\n---\n\n'),
        cache_control: { type: 'ephemeral' }, // breakpoint 3/4
      });
    }
  }

  // Tier 4: glossary — no cache marker (volatile by design)
  const terms = [...(input.glossaryTerms ?? [])].sort();
  for (const t of terms) {
    const c = await readOptional(
      resolve(REPO_ROOT, 'apps/docs/content/product/glossary', `${t}.md`),
      `glossary/${t}`,
    );
    if (c) blocks.push({ type: 'text', text: c });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Convenience API — flat string with byte budget (per task brief)
// ---------------------------------------------------------------------------

export async function buildContext(opts: BuildContextOpts): Promise<string> {
  const root = opts.repoRoot ?? REPO_ROOT;
  const sections: string[] = [];

  // ADRs
  for (const a of [...(opts.relevantAdrs ?? [])].sort()) {
    const file = await findAdrFile(a, root);
    if (!file) {
      process.stderr.write(`[buildContext] WARN: ADR ${a} not found — skipping.\n`);
      continue;
    }
    const body = await readOptional(file, `ADR ${a}`);
    if (body) sections.push(`## ${a}\n\n${body}`);
  }

  // Glossary terms
  for (const t of [...(opts.glossaryTerms ?? [])].sort()) {
    const body = await readOptional(
      resolve(root, 'apps/docs/content/product/glossary', `${t}.md`),
      `glossary/${t}`,
    );
    if (body) sections.push(`## Glossary: ${t}\n\n${body}`);
  }

  // Extra files (verbatim, in given order)
  for (const f of opts.extraFiles ?? []) {
    const body = await readOptional(resolve(root, f), f);
    if (body) sections.push(`## ${f}\n\n${body}`);
  }

  // Task
  sections.push(`## Task\n\n${opts.task}`);

  let blob = sections.join('\n\n---\n\n');
  if (Buffer.byteLength(blob, 'utf-8') > BYTE_BUDGET) {
    blob = blob.slice(0, BYTE_BUDGET) + '\n\n... [truncated]';
  }
  return blob;
}
