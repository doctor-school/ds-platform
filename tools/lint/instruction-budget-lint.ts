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
 * Skills (`apps/docs/content/skills/<name>/SKILL.md`, #416) are read-on-demand, not
 * always-on — they never enter the session-start window, so the concern is
 * per-file scannability, not context rot. We reuse the SAME 200-line / 25 KB
 * ceiling (no new magic number; every skill already fits with headroom — the
 * largest is ~13 KB) but at WARN level in Phase 0: an over-budget skill prints a
 * warning and is listed, without failing the run. Skills do NOT contribute to
 * the always-on total.
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

// TEST SEAM: `LINT_FIXTURE_ROOT` points the always-on repo-file budget checks
// (AGENTS.md, CLAUDE.md, .claude/rules/*.md) at a fixture tree. Inert in
// production — when unset the root resolves to the repo root exactly as before.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[instruction-budget]";

const MAX_LINES = 200;
const MAX_BYTES = 25 * 1024; // 25 KB, matching the MEMORY.md auto-load cutoff
const CLAUDE_SOFT_LINES = 120; // high-signal target (WARN only)

interface Target {
  label: string;
  path: string;
  optional: boolean; // outside git (auto-memory) — skip when absent
  softLines?: number;
  warnOnly?: boolean; // over-budget WARNs instead of failing (Phase-0 skills, #416)
  offTotal?: boolean; // not part of the always-on total (read-on-demand skills)
}

// MEMORY.md path: derive from this repo's auto-memory dir convention
// (~/.claude/projects/<project>/memory/MEMORY.md). The <project> segment is the
// working-dir path with separators replaced by '-'. We resolve it best-effort;
// if it isn't found, the file is treated as skipped (CI has no auto-memory dir).
function memoryPath(): string | null {
  // TEST SEAM: `LINT_MEMORY_FILE` points the MEMORY.md budget check at a fixture
  // file directly, bypassing the HOME + project-slug derivation (the slug is the
  // absolute REPO_ROOT mangled, which is machine-specific and so cannot be
  // pre-laid-out as a fixture). Inert in production — when unset the real
  // auto-memory path is derived exactly as before.
  const override = process.env.LINT_MEMORY_FILE;
  if (override) return existsSync(override) ? resolve(override) : null;
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

// Skills (apps/docs/content/skills/*/SKILL.md, #416) are read-on-demand — cap
// them so a skill can't silently re-bloat, but at WARN level in Phase 0 and OFF
// the always-on total (they never load at session start). Same 200 L / 25 KB
// ceiling as the always-on files; the concern is per-file scannability.
const skillsDir = resolve(REPO_ROOT, "apps", "docs", "content", "skills");
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    const p = resolve(skillsDir, d, "SKILL.md");
    if (existsSync(p)) {
      targets.push({ label: `skill: ${d} (on-demand)`, path: p, optional: false, warnOnly: true, offTotal: true });
    }
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
  if (!t.label.includes("(lazy)") && !t.offTotal) {
    totalLines += lineCount;
    totalBytes += bytes;
  }

  const overLines = lineCount > MAX_LINES;
  const overBytes = bytes > MAX_BYTES;
  const over = overLines || overBytes;
  const status = over ? (t.warnOnly ? "WARN" : "OVER BUDGET") : "ok";
  lines.push(
    `${TAG} ${status.padEnd(11)} ${t.label}: ${lineCount} lines / ${(bytes / 1024).toFixed(1)} KB ` +
      `(limit ${MAX_LINES} lines / ${(MAX_BYTES / 1024).toFixed(0)} KB)`,
  );
  // Phase-0 skills (#416): over-budget is a WARN, not a failure — surface it on
  // stderr for visibility but don't fail the run.
  const flag = (msg: string) => {
    process.stderr.write(`${TAG} ${t.warnOnly ? "WARN " : ""}${msg}\n`);
    if (!t.warnOnly) failed = true;
  };
  if (overLines) {
    flag(`${t.label}: ${lineCount} lines > ${MAX_LINES}. Relocate detail to .claude/rules/*.md or a skill/topic file.`);
  }
  if (overBytes) {
    flag(`${t.label}: ${(bytes / 1024).toFixed(1)} KB > ${(MAX_BYTES / 1024).toFixed(0)} KB. Relocate detail to .claude/rules/*.md or a skill/topic file.`);
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
