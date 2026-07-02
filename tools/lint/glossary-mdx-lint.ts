#!/usr/bin/env tsx
/**
 * tools/lint/glossary-mdx-lint.ts — guard (job `glossary-mdx`) for the ADR-0006
 * §6 MDX glossary-lint layer: a `[[term-id]]` glossary directive in docs/MDX
 * prose must resolve to a glossary canonical id. Implemented per Issue #448 (was
 * a 5-line exit-0 stub gating merge vacuously once #440 wired it into `ci`).
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * In `apps/docs/content/** /*.{md,mdx}` (excluding the glossary source dir), every
 * `[[id]]` or `[[id|display]]` directive must resolve to a glossary canonical id
 * (read from the source via lib/glossary.ts), UNLESS the same line carries a
 * `new-term: <id>` opt-out marker (ADR-0006 §6.4 — a new term whose glossary entry
 * arrives in the same PR). An unresolved, un-opted-out directive → FAIL.
 *
 * ── The `[[…]]` namespace is OVERLOADED — deterministic scoping to avoid FPs ───
 * The `[[…]]` syntax ADR-0006 §6.4 picked for glossary directives is ALSO used,
 * pervasively and pre-existing, for two OTHER things in this repo:
 *   1. memory / decision cross-references — `[[reference_beget_dns]]`,
 *      `[[feedback_…]]`, `[[project_…]]` — in plain ADR prose. ADR-0006 §7.0 lists
 *      "spec link integrity (no broken `[[refs]]`)" as its OWN separate check;
 *      those refs are NOT glossary terms. → excluded by the memory-namespace
 *      prefixes below.
 *   2. documentation-OF-the-syntax — the `[[doctor]]` / `[[term_id]]` / `[[refs]]`
 *      examples inside ADR-0006's own code fences and inline-code spans. → removed
 *      by masking fenced code blocks + inline code spans before matching.
 * After both exclusions, a residual `[[id]]` in live prose is a real glossary
 * directive and must resolve. This disambiguation is HEURISTIC (a new memory
 * prefix or a novel prose cross-ref could slip the net), which is exactly why the
 * job is burned in as WARN rather than a hard BLOCK — see the posture note.
 *
 * ── Posture (recorded on the ci.yml job header) ───────────────────────────────
 * BURN-IN: `continue-on-error: true` (WARN), and REMOVED from the `ci` needs-list
 * (BLOCK = in needs-list, WARN = continue-on-error — never both). Rationale:
 *   (a) ADR-0006 §7.0 phases glossary-mdx into the Pilot tier (the #449 posture
 *       note flags this) — it is not a pre-pilot-mandatory check;
 *   (b) the `[[…]]` namespace overload above makes resolution a heuristic
 *       disambiguation, not the clean literal artifact comparison that events-drift
 *       / glossary-roundtrip are — a real false-positive class exists;
 *   (c) no real glossary `[[term-id]]` directive is in use yet, so as a BLOCK gate
 *       it would gate nothing real while carrying that FP risk.
 * Re-entry criterion (promote to BLOCK + back into the needs-list): when the
 * glossary generation pipeline (ADR-0006 §6.2) + real `[[term-id]]` usage land AND
 * the Pilot phase opens, earliest sweep 2026-07-02 per ADR-0007 §2.6 + ADR-0006 §7.0.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) — inert in production.
 * Run: `pnpm lint:glossary-mdx`. Findings: stderr + exit 1. Clean: stdout + exit 0.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

import { readGlossaryIds } from "./lib/glossary";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[glossary-mdx]";

// `[[term_id]]` or `[[term_id|display label]]` — snake_case id, optional label.
const DIRECTIVE_RE = /\[\[([a-z][a-z0-9_]*)(?:\|[^\]]+)?\]\]/g;
// Memory / decision cross-reference namespace (ADR-0006 §7.0 `[[refs]]` check,
// NOT glossary). Auto-memory topic prefixes (MEMORY.md sections).
const CROSSREF_PREFIX_RE = /^(?:reference|feedback|project)_/;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * Blank out fenced code blocks (``` / ~~~) and inline code spans (`…`) so the
 * `[[…]]` examples documented INSIDE code (ADR-0006 §6.4's own illustrations) are
 * not read as live directives. Replaces masked runs with spaces to preserve
 * newline layout + character offsets (so per-line opt-out lookup stays correct).
 */
function maskCode(text: string): string {
  let out = text;
  // Fenced blocks first (``` … ``` or ~~~ … ~~~), across lines.
  out = out.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1?\2[^\n]*$/gm, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  // Then inline code spans (`…`, ``…``) — single line.
  out = out.replace(/(`+)(?:(?!\1).)*\1/g, (m) => m.replace(/[^\n]/g, " "));
  return out;
}

async function main(): Promise<void> {
  const validIds = await readGlossaryIds(REPO_ROOT);
  const files = await fg("apps/docs/content/**/*.{md,mdx}", {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**", "**/product/glossary/**"],
  });

  const errors: string[] = [];
  let directiveCount = 0;

  for (const rel of files) {
    const posix = rel.replace(/\\/g, "/");
    const raw = await readFile(resolve(REPO_ROOT, rel), "utf8");
    const masked = maskCode(raw);
    DIRECTIVE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECTIVE_RE.exec(masked)) !== null) {
      const id = m[1];
      // Skip the memory/decision cross-reference namespace (separate §7.0 check).
      if (CROSSREF_PREFIX_RE.test(id)) continue;
      directiveCount++;
      if (validIds.has(id)) continue;
      // Same-line `new-term: <id>` opt-out (a new term added in the same PR).
      const lineStart = raw.lastIndexOf("\n", m.index) + 1;
      const lineEndRaw = raw.indexOf("\n", m.index);
      const line = raw.slice(lineStart, lineEndRaw === -1 ? raw.length : lineEndRaw);
      if (line.includes(`new-term: ${id}`)) continue;
      errors.push(
        `${posix}: [[${id}]] does not resolve to a glossary term (and has no \`new-term: ${id}\` opt-out).`,
      );
    }
  }

  info(
    `scanned ${files.length} doc file(s); ${directiveCount} glossary directive(s) after code/cross-ref masking; ` +
      `${validIds.size} glossary term(s) in source.`,
  );

  if (errors.length === 0) {
    info("PASS — every glossary directive resolves (or carries a new-term opt-out).");
    process.exit(0);
  }

  for (const e of errors) process.stderr.write(`${TAG} ${e}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${errors.length} unresolved glossary directive(s). Per ADR-0006 §6.4 a ` +
      `[[term-id]] must exist in the glossary (apps/docs/content/product/glossary/), or carry a ` +
      `same-line \`new-term: <id>\` opt-out with the glossary entry added in the same PR.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
