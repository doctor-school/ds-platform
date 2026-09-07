#!/usr/bin/env tsx
/**
 * Effective root startup budgets for Claude Code and Codex (#250, #1918).
 * Each file <=200 lines /25 KB; each harness total <=30 KB.
 * Claude: AGENTS + CLAUDE + path-less rules. Codex: root AGENTS.override
 * when present, otherwise AGENTS. Both include the mandatory shared startup
 * reference: a manual mandatory read consumes the same context as an import.
 * Scoped rules and role definitions keep per-file caps; catalog skills and
 * their reference docs are on-demand WARN-only. Local Claude MEMORY keeps its
 * per-file cap, excluded from deterministic repo totals. Global/ancestor files,
 * nested cwd chains and actual model usage are outside this root-only report.
 * Optional --harness all|claude|codex; default all. Unknown options fail closed.
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
const args = process.argv.slice(2);
const harness = args.length === 0 ? "all" : args.length === 2 && args[0] === "--harness" ? args[1] : "invalid";
if (!["all", "claude", "codex"].includes(harness)) {
  process.stderr.write(`${TAG} Usage: pnpm lint:instruction-budget [--harness all|claude|codex]\n`);
  process.exit(2);
}
const checkClaude = harness !== "codex";
const checkCodex = harness !== "claude";
const codexRootFile = existsSync(resolve(REPO_ROOT, "AGENTS.override.md")) ? "AGENTS.override.md" : "AGENTS.md";

const MAX_LINES = 200;
const MAX_BYTES = 25 * 1024; // 25 KB, matching the MEMORY.md auto-load cutoff
const MAX_TOTAL_BYTES = 30 * 1024; // 30 KB across the whole always-on set (#1678)
const CLAUDE_SOFT_LINES = 120; // high-signal target (WARN only)
const HEADROOM_WARN_BYTES = 256; // always-on byte-headroom WARN tier (#1042)

interface Target {
  label: string;
  path: string;
  optional: boolean; // outside git (auto-memory) — skip when absent
  softLines?: number;
  warnOnly?: boolean; // over-budget WARNs instead of failing (Phase-0 skills, #416)
  offTotal?: boolean; // not part of the always-on total (read-on-demand skills, `paths:`-scoped rules, MEMORY.md)
  sessionStart?: boolean; // loads in full at session start → eligible for the byte-headroom WARN (#1042)
  codexTotal?: boolean; // part of Codex's root instruction chain, not the Claude import set
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

const memPath = checkClaude ? memoryPath() : null;

const targets: Target[] = [
  ...(checkClaude || (checkCodex && codexRootFile === "AGENTS.md")
    ? [{ label: "AGENTS.md", path: resolve(REPO_ROOT, "AGENTS.md"), optional: false, sessionStart: true, offTotal: !checkClaude, codexTotal: checkCodex && codexRootFile === "AGENTS.md" }]
    : []),
  ...(checkClaude
    ? [{ label: "CLAUDE.md", path: resolve(REPO_ROOT, "CLAUDE.md"), optional: false, softLines: CLAUDE_SOFT_LINES, sessionStart: true }]
    : []),
  ...(checkCodex && codexRootFile === "AGENTS.override.md"
    ? [{ label: codexRootFile, path: resolve(REPO_ROOT, codexRootFile), optional: false, sessionStart: true, offTotal: true, codexTotal: true }]
    : []),
  // MEMORY.md keeps its per-file budget and its headroom WARN, but is OFF the
  // always-on total (#1680): it lives outside git, so counting it would make the
  // total verdict machine-dependent — green in CI, red on one developer's box —
  // and its own 200-line / 25 KB auto-load cutoff already bounds it.
  ...(memPath
    ? [{ label: "MEMORY.md (auto-memory index)", path: memPath, optional: true, offTotal: true, sessionStart: true } as Target]
    : []),
];

/**
 * Does this rules file carry REAL `paths:` frontmatter, i.e. is it lazy?
 *
 * Claude Code's contract (https://code.claude.com/docs/en/memory) is narrow, and
 * the classifier must be exactly as narrow — anything it calls lazy is dropped
 * from the always-on total, so a false positive silently under-reports the
 * session window by the file's whole size. All three conditions must hold:
 *
 *   1. the opening `---` delimiter is the FIRST BYTES of the file (a leading
 *      UTF-8 BOM is tolerated; a comment, a blank line, or any prose above it is
 *      not — then the `---` is a markdown thematic break, not frontmatter);
 *   2. the block is TERMINATED by a closing `---` (or YAML `...`) delimiter line;
 *   3. it declares `paths` as a TOP-LEVEL key (column 0) inside that block.
 *
 * Anything else — the word `paths:` in the body, an unterminated block, `paths`
 * nested under another key — is an always-on file (#1370).
 */
function hasPathsFrontmatter(raw: string): boolean {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip BOM
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return false; // (1) must be the literal first bytes
  const close = lines.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
  if (close === -1) return false; // (2) unterminated ⇒ not frontmatter
  // (3) top-level `paths` key: column 0, no leading indent, not a `#` comment.
  return lines.slice(1, close).some((l) => /^paths\s*:/.test(l));
}

// .claude/rules/*.md are always-on too — loaded at session start UNLESS a file
// carries `paths:` frontmatter (which makes it lazy / file-scoped). Add each so
// the per-file budget applies and a new always-on rule can't silently grow the
// window unnoticed.
const rulesDir = resolve(REPO_ROOT, ".claude", "rules");
if (checkClaude && existsSync(rulesDir)) {
  for (const f of readdirSync(rulesDir).filter((n) => n.endsWith(".md")).sort()) {
    const p = resolve(rulesDir, f);
    const lazy = hasPathsFrontmatter(readFileSync(p, "utf8"));
    targets.push({
      label: `.claude/rules/${f}${lazy ? " (lazy)" : " (always-on)"}`,
      path: p,
      optional: false,
      // A `paths:`-scoped rules file is read-on-demand (file-glob-triggered), so
      // it never enters the session-start window — same treatment as skills: the
      // per-file budget still applies, the always-on total excludes it.
      offTotal: lazy,
      sessionStart: !lazy,
    });
  }
}

// Mandatory manual startup reads consume context just like automatic imports.
// Role definitions remain dispatch-specific, outside the root startup total.
const portableReference = resolve(REPO_ROOT, "apps/docs/content/agent-discipline.md");
const requiresPortableReference = targets.some((target) =>
  target.sessionStart && existsSync(target.path) && readFileSync(target.path, "utf8").includes("apps/docs/content/agent-discipline.md"),
);
if (requiresPortableReference || existsSync(portableReference)) {
  targets.push({ label: "agent-discipline.md (mandatory startup read)", path: portableReference, optional: false, offTotal: !checkClaude, codexTotal: checkCodex, sessionStart: true });
}
const codexAgentsDir = resolve(REPO_ROOT, ".codex/agents");
if (checkCodex && existsSync(codexAgentsDir)) {
  for (const name of readdirSync(codexAgentsDir).filter((n) => n.endsWith(".toml")).sort()) {
    targets.push({ label: `Codex role: ${name} (on-demand)`, path: resolve(codexAgentsDir, name), optional: false, offTotal: true });
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
      for (const name of readdirSync(resolve(skillsDir, d)).filter((n) => n.endsWith(".md") && n !== "SKILL.md").sort()) {
        targets.push({ label: `skill reference: ${d}/${name} (on-demand)`, path: resolve(skillsDir, d, name), optional: false, warnOnly: true, offTotal: true });
      }
    }
  }
}

let failed = false;
let totalLines = 0;
let totalBytes = 0;
let codexLines = 0;
let codexBytes = 0;
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
  if (!t.offTotal) {
    totalLines += lineCount;
    totalBytes += bytes;
  }
  if (t.codexTotal) {
    codexLines += lineCount;
    codexBytes += bytes;
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
  // Headroom WARN tier (#1042): a file that LOADS AT SESSION START (never lazy
  // rules, never read-on-demand skills) and is WITHIN budget but has < 256 B left
  // before the byte ceiling gets a WARN — the next edit would force ad-hoc
  // squeezing of canonical rules. Keyed on `sessionStart`, not `offTotal`:
  // MEMORY.md is off the total yet still loads every session (#1680).
  const headroom = MAX_BYTES - bytes;
  if (!over && t.sessionStart && headroom < HEADROOM_WARN_BYTES) {
    lines.push(
      `${TAG} WARN        ${t.label}: low byte-headroom — ${bytes} B used, ${headroom} B remaining ` +
        `(< ${HEADROOM_WARN_BYTES} B before the ${(MAX_BYTES / 1024).toFixed(0)} KB ceiling) — compact before the next always-on edit (not a failure).`,
    );
  }
}

const overTotal = checkClaude && totalBytes > MAX_TOTAL_BYTES;
if (checkClaude) {
lines.push(
  `${TAG} ${(overTotal ? "OVER BUDGET" : "ok").padEnd(11)} always-on total: ${totalLines} lines / ${(totalBytes / 1024).toFixed(1)} KB ` +
    `(limit ${(MAX_TOTAL_BYTES / 1024).toFixed(0)} KB) ` +
    `(Claude always-on total: AGENTS.md + CLAUDE.md + mandatory shared startup reference + path-less .claude/rules/*.md; MEMORY.md excluded — machine-local)`,
);
}
if (overTotal) {
  process.stderr.write(
    `${TAG} always-on total: ${(totalBytes / 1024).toFixed(1)} KB > ${(MAX_TOTAL_BYTES / 1024).toFixed(0)} KB. ` +
      `Per-file budgets are individually satisfied — the SESSION WINDOW is not. ` +
      `Relocate detail to a \`paths:\`-scoped .claude/rules/*.md file or a read-on-demand skill (both off the total).\n`,
  );
  failed = true;
}
if (checkCodex) {
  const overCodexTotal = codexBytes > MAX_TOTAL_BYTES;
  lines.push(`${TAG} ${(overCodexTotal ? "OVER BUDGET" : "ok").padEnd(11)} Codex always-on total: ${codexLines} lines / ${(codexBytes / 1024).toFixed(1)} KB (limit 30 KB) (${codexRootFile} + mandatory shared startup reference; root cwd, global instructions/memory and on-demand files excluded)`);
  if (overCodexTotal) {
    process.stderr.write(`${TAG} Codex always-on total: ${(codexBytes / 1024).toFixed(1)} KB > 30 KB. Compact the root instruction chain.\n`);
    failed = true;
  }
}

process.stdout.write(lines.join("\n") + "\n");
if (failed) {
  process.stderr.write(`${TAG} FAIL — an always-on file, or the always-on total, is over budget. Compact before declaring the session done.\n`);
  process.exit(1);
}
process.stdout.write(`${TAG} PASS — always-on context within budget.\n`);
process.exit(0);
