#!/usr/bin/env tsx
/**
 * tools/lint/axe-exclude-lint.ts — WARN v1 axe-exclude scope guard (Issue #785B).
 *
 * Why this exists: an e2e a11y scan can exclude a whole LAYOUT BAND from the axe
 * check, and anything that happens to sit inside that band silently escapes the
 * gate. #713 shipped `AxeBuilder.exclude(".bg-header")` on the portal webinar
 * scan; the interactive theme-toggle glyph (#702) sits INSIDE the `.bg-header`
 * band, so its 3.69:1 contrast was never measured — "gate-evasion-by-geography".
 * The interim rule is memory `feedback_axe_exclude_leaf_not_container`; this guard
 * is its deterministic enforcement: an `AxeBuilder.exclude(...)` selector must be
 * LEAF-scoped (a specific element), or the container-band exclude must carry an
 * inline tracking-Issue marker.
 *
 * ── What it scans ─────────────────────────────────────────────────────────────
 * Every e2e a11y spec that drives `@axe-core/playwright`'s `AxeBuilder`, matched
 * by the `SPEC_GLOB` below (any `*axe*.e2e.spec.ts` under an app's `e2e/` tree).
 * For each `.exclude(<sel>)` call it classifies every selector-string argument (a
 * bare string, or each string in
 * an array `.exclude(['a','b'])`):
 *
 *   - LEAF (PASS): the selector targets a specific element — it contains a
 *     `#id` OR any attribute selector `[…]` (e.g. `[data-testid="room-player"]`).
 *   - CONTAINER-BAND (FINDING): a bare landmark element
 *     (`main|header|footer|nav|section|aside|article|body|html`) OR a bare single
 *     class selector with no `[attr]`/descendant qualifier (e.g. `.bg-header`).
 *     These swallow arbitrary downstream content.
 *   - Anything else (a descendant/qualified selector like `.card .title`) is left
 *     alone — it is already narrower than a band, so the guard does not guess.
 *
 * ── Escape marker ─────────────────────────────────────────────────────────────
 * A container-band exclude is allowed ONLY when an inline tracking marker sits on
 * the exclude line OR the immediately preceding line:
 *   `// axe-exclude-ok: #<issue> <reason>`
 * BOTH the `#<issue>` ref AND a non-empty `<reason>` are mandatory — a marker
 * missing either is not a valid escape and the exclude stays a finding.
 *
 * ── Output / severity ─────────────────────────────────────────────────────────
 * Each finding → stderr `relative/file:line -> <selector>`; exit 1 if any, else
 * exit 0. WARN v1 in Phase 0 (ADR-0007 §2.6; new guard lands WARN, CI job uses
 * `continue-on-error: true`, promote to BLOCK once stable).
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) points the scan at a fixture
 * tree; inert in production (unset → repo root from import.meta.url).
 * Run: `pnpm lint:axe-exclude`. Findings: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at a
// fixture tree (tools/lint/guard-tests). Inert in production — when unset the root
// resolves to the repo root exactly as before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[axe-exclude]";

/** e2e a11y specs that drive `AxeBuilder` (relative to REPO_ROOT). */
const SPEC_GLOB = "apps/*/e2e/**/*axe*.e2e.spec.ts";
const SPEC_IGNORE = ["**/node_modules/**", "**/.next/**"];

/** Landmark elements — a bare one excludes a whole document region. */
const LANDMARKS = [
  "main",
  "header",
  "footer",
  "nav",
  "section",
  "aside",
  "article",
  "body",
  "html",
];

// `.exclude(` … `)` — capture the argument list up to the first `)` on the line
// (axe exclude args are selector literals, no nested parens in practice).
const EXCLUDE_RE = /\.exclude\(([^)]*)\)/g;
// A string literal inside the exclude args: '…' | "…" | `…`.
const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// Inline escape marker (this line or the preceding line): the `#N` + reason are
// validated separately.
const MARKER_RE = /axe-exclude-ok\s*:\s*(.*)$/i;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

interface Finding {
  file: string;
  line: number;
  selector: string;
}

/** Does a selector target a specific element (id or attribute selector)? */
function isLeafSelector(sel: string): boolean {
  return /#/.test(sel) || /\[[^\]]+\]/.test(sel);
}

/** Is a selector a bare landmark element or a bare single class (a layout band)? */
function isContainerBand(sel: string): boolean {
  const s = sel.trim();
  if (LANDMARKS.includes(s)) return true; // bare landmark element
  if (/^\.[A-Za-z0-9_-]+$/.test(s)) return true; // bare single class, no qualifier
  return false;
}

/**
 * Is there a VALID escape marker (`#N` + non-empty reason) on the exclude line or
 * the immediately preceding one? A marker missing either part does not count.
 */
function hasValidMarker(lines: string[], idx: number): boolean {
  for (const candidate of [lines[idx], lines[idx - 1]]) {
    if (candidate === undefined) continue;
    const m = candidate.match(MARKER_RE);
    if (!m) continue;
    const rest = m[1];
    const issue = rest.match(/#\d+/);
    if (!issue) continue; // marker without a tracked Issue tracks nothing
    const reason = rest.replace(/#\d+/, "").trim();
    if (reason.length === 0) continue; // marker without a reason is illegible debt
    return true;
  }
  return false;
}

function scanFile(file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    EXCLUDE_RE.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = EXCLUDE_RE.exec(line)) !== null) {
      const args = call[1];
      STRING_RE.lastIndex = 0;
      let str: RegExpExecArray | null;
      while ((str = STRING_RE.exec(args)) !== null) {
        const selector = str[2];
        if (isLeafSelector(selector)) continue; // specific element — fine
        if (!isContainerBand(selector)) continue; // qualified/descendant — not a band
        if (hasValidMarker(lines, idx)) continue; // tracked container-band exclude
        findings.push({ file, line: idx + 1, selector });
      }
    }
  });
  return findings;
}

async function main(): Promise<void> {
  const specs = await fg([SPEC_GLOB], {
    cwd: REPO_ROOT,
    ignore: SPEC_IGNORE,
    absolute: true,
  });

  const findings: Finding[] = [];
  for (const spec of specs) findings.push(...scanFile(spec));

  info(`scanned ${specs.length} axe e2e spec(s).`);

  if (findings.length === 0) {
    info(
      "PASS — every AxeBuilder.exclude() is leaf-scoped or carries a tracked-Issue marker.",
    );
    process.exit(0);
  }

  for (const f of findings) {
    const rel = relative(REPO_ROOT, f.file).replace(/\\/g, "/");
    process.stderr.write(`${TAG} ${rel}:${f.line} -> ${f.selector}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} AxeBuilder.exclude() call(s) exclude a whole ` +
      `container band from the a11y scan, hiding arbitrary downstream content ` +
      `(#713 theme-toggle contrast). Leaf-scope the exclude to a specific element ` +
      `(\`[data-testid=…]\`/\`#id\`), or, if the band exclude is genuinely required, ` +
      `add \`// axe-exclude-ok: #<issue> <reason>\` on the exclude line naming a ` +
      `tracking Issue.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
