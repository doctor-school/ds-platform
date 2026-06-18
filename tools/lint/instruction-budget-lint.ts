#!/usr/bin/env tsx
/**
 * tools/lint/instruction-budget-lint.ts — anti-bloat budget for the always-on
 * agent context (epic #247, child #250).
 *
 * Why: the always-on context (AGENTS.md + CLAUDE.md + every path-less
 * .claude/rules/*.md, loaded in full every session; MEMORY.md, of which only
 * the first 200 lines / 25 KB load) suffers
 * "context rot" as it grows — the model's recall of any single rule degrades as
 * total tokens rise (Anthropic, "Effective context engineering for AI agents").
 * Anthropic's CLAUDE.md guidance is "target under 200 lines"; auto-memory loads
 * only the first 200 lines OR 25 KB of MEMORY.md, whichever comes first. We
 * adopt that as a hard ceiling for every always-on file and let `/wrap` (and,
 * optionally, CI) enforce it so the file cannot silently grow back.
 *
 * Sources:
 *   https://code.claude.com/docs/en/memory  (size + 200-line/25 KB load rule)
 *   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
 *
 * Budgets (per file):
 *   - lines:  <= 200   (Anthropic CLAUDE.md target + MEMORY.md load cutoff)
 *   - bytes:  <= 25 KB  (MEMORY.md load cutoff; applied to all three for headroom)
 *   CLAUDE.md additionally carries a softer high-signal WARN target of 120 lines.
 *
 * Run: `pnpm lint:instruction-budget` (also the `/wrap` budget step).
 * Failures: stderr + exit 1. Success: stdout summary + exit 0.
 *
 * Note: MEMORY.md lives OUTSIDE git (auto-memory dir). It is checked only when
 * present and resolvable locally; in CI (no auto-memory dir) it is skipped with
 * a note, so the always-on repo files (AGENTS.md, CLAUDE.md) are the CI gate.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[instruction-budget]";

const MAX_LINES = 200;
const MAX_BYTES = 25 * 1024; // 25 KB, matching the MEMORY.md auto-load cutoff
const CLAUDE_SOFT_LINES = 120; // high-signal target (WARN only)

interface Target {
  label: string;
  path: string;
  optional: boolean; // outside git (auto-memory) — skip when absent
  softLines?: number;
}

// MEMORY.md path: derive from this repo's auto-memory dir convention
// (~/.claude/projects/<project>/memory/MEMORY.md). The <project> segment is the
// working-dir path with separators replaced by '-'. We resolve it best-effort;
// if it isn't found, the file is treated as skipped (CI has no auto-memory dir).
function memoryPath(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  // Project slug used by Claude Code, e.g. C--Users-sidor-repos-ds-platform
  const slug = REPO_ROOT.replace(/[\\/:]/g, "-");
  const candidate = resolve(home, ".claude", "projects", slug, "memory", "MEMORY.md");
  return existsSync(candidate) ? candidate : null;
}

const memPath = memoryPath();

const targets: Target[] = [
  { label: "AGENTS.md", path: resolve(REPO_ROOT, "AGENTS.md"), optional: false },
  { label: "CLAUDE.md", path: resolve(REPO_ROOT, "CLAUDE.md"), optional: false, softLines: CLAUDE_SOFT_LINES },
  ...(memPath ? [{ label: "MEMORY.md (auto-memory index)", path: memPath, optional: true } as Target] : []),
];

// .claude/rules/*.md are always-on too — loaded at session start UNLESS a file
// carries `paths:` frontmatter (which makes it lazy / file-scoped). Add each so
// the per-file budget applies and a new always-on rule can't silently grow the
// window unnoticed.
const rulesDir = resolve(REPO_ROOT, ".claude", "rules");
if (existsSync(rulesDir)) {
  for (const f of readdirSync(rulesDir).filter((n) => n.endsWith(".md")).sort()) {
    const p = resolve(rulesDir, f);
    const lazy = /^---[\s\S]*?\bpaths\s*:/m.test(readFileSync(p, "utf8").slice(0, 800));
    targets.push({ label: `.claude/rules/${f}${lazy ? " (lazy)" : " (always-on)"}`, path: p, optional: false });
  }
}

let failed = false;
let totalLines = 0;
let totalBytes = 0;
const lines: string[] = [];

for (const t of targets) {
  if (!existsSync(t.path)) {
    if (t.optional) {
      lines.push(`${TAG} skip ${t.label} — not present locally (auto-memory dir absent, e.g. CI).`);
      continue;
    }
    process.stderr.write(`${TAG} MISSING required file: ${t.path}\n`);
    failed = true;
    continue;
  }
  const buf = readFileSync(t.path);
  const bytes = buf.length;
  const lineCount = buf.toString("utf8").split(/\r?\n/).length;
  if (!t.label.includes("(lazy)")) {
    totalLines += lineCount;
    totalBytes += bytes;
  }

  const overLines = lineCount > MAX_LINES;
  const overBytes = bytes > MAX_BYTES;
  const status = overLines || overBytes ? "OVER BUDGET" : "ok";
  lines.push(
    `${TAG} ${status.padEnd(11)} ${t.label}: ${lineCount} lines / ${(bytes / 1024).toFixed(1)} KB ` +
      `(limit ${MAX_LINES} lines / ${(MAX_BYTES / 1024).toFixed(0)} KB)`,
  );
  if (overLines) {
    process.stderr.write(`${TAG} ${t.label}: ${lineCount} lines > ${MAX_LINES}. Relocate detail to .claude/rules/*.md or a skill/topic file.\n`);
    failed = true;
  }
  if (overBytes) {
    process.stderr.write(`${TAG} ${t.label}: ${(bytes / 1024).toFixed(1)} KB > ${(MAX_BYTES / 1024).toFixed(0)} KB. Relocate detail to .claude/rules/*.md or a skill/topic file.\n`);
    failed = true;
  }
  if (!overLines && t.softLines && lineCount > t.softLines) {
    lines.push(`${TAG} WARN        ${t.label}: ${lineCount} lines > soft target ${t.softLines} — consider trimming (not a failure).`);
  }
}

lines.push(
  `${TAG} always-on total: ${totalLines} lines / ${(totalBytes / 1024).toFixed(1)} KB ` +
    `(AGENTS.md + CLAUDE.md${memPath ? " + MEMORY.md" : ""} + path-less .claude/rules/*.md)`,
);

process.stdout.write(lines.join("\n") + "\n");
if (failed) {
  process.stderr.write(`${TAG} FAIL — at least one always-on file is over budget. Compact before declaring the session done.\n`);
  process.exit(1);
}
process.stdout.write(`${TAG} PASS — always-on context within budget.\n`);
process.exit(0);
