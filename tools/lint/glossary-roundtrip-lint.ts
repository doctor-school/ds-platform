#!/usr/bin/env tsx
/**
 * tools/lint/glossary-roundtrip-lint.ts — BASELINE hard-red guard (job
 * `glossary-roundtrip`) for the ADR-0006 §6 glossary roundtrip check: the
 * glossary SOURCE-of-truth and the GENERATED id artifact stay in lockstep.
 * Implemented per Issue #448 (was a 5-line exit-0 stub gating merge vacuously
 * once #440 wired the job into the `ci` needs-list).
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * The set of canonical ids in the glossary source
 * (`apps/docs/content/product/glossary/*.md`, read via the body marker
 * ``**Canonical id:** `id` `` — see lib/glossary.ts) must EQUAL the set of keys
 * in the generated `GLOSSARY_IDS` const (`packages/glossary/src/ids.ts`, or the
 * ADR/AGENTS-cited `packages/glossary/ids.ts`). Any asymmetry is drift:
 *   - source id absent from ids.ts → `pnpm generate:glossary` not run → FAIL.
 *   - generated id with no source term → orphan/stale generated id → FAIL.
 * This is parse-and-compare (a pure read/diff, no side effects) rather than
 * regenerate-and-diff, because the ADR-0006 §6.2 generator does NOT exist yet —
 * there is nothing to execute. When the generator lands, it becomes the
 * lockstep source and the committed `ids.ts` is what this guard diffs against
 * (the `tokens-fresh` "generated artifact is committed + up to date" pattern).
 *
 * ── Empty-state = REAL evaluated emptiness (NOT a hardcoded exit 0) ────────────
 * `packages/glossary` is an empty package today (just package.json): there is no
 * `src/ids.ts`, no generator script, no `generate:glossary`. So the guard SCANS,
 * finds NO generated artifact, and reports "generated artifact not present —
 * nothing to roundtrip" (exit 0). This is evaluated emptiness, not a stub: the
 * moment `packages/glossary/(src/)?ids.ts` lands, the guard bites on any drift
 * between it and the glossary source.
 *
 * ── Posture (recorded on the ci.yml job header) ───────────────────────────────
 * KEPT hard-red (BLOCK, in the `ci` needs-list). It is a deterministic pure
 * set comparison with no false-positive class, and clean (empty) on `main`.
 * ADR-0006 §7.0 phases roundtrip into the Pilot tier — that phasing addressed
 * FALSE-POSITIVE / overhead noise, which a symmetric id-set diff on a
 * currently-ABSENT artifact cannot produce; it can only fire on a genuine
 * source↔generated drift, which is worth blocking the instant the pipeline lands.
 * So the deterministic + clean criterion wins over the Pilot phasing here.
 * (Contrast glossary-mdx, burned in for genuine `[[…]]` namespace ambiguity.)
 *
 * ── Doc-reality mismatch (reported on #448, not fixed here) ────────────────────
 * ADR-0006 §6 body / AGENTS.md §8 cite the artifact as `packages/glossary/ids.ts`;
 * design §6.2 as `packages/glossary/src/ids.ts`. The whole §6.2 pipeline is
 * unbuilt. The guard accepts either path so it works whichever the pipeline picks.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) — inert in production.
 * Run: `pnpm lint:glossary-roundtrip`. Findings: stderr + exit 1. Clean/empty: exit 0.
 */
import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readGlossarySource } from "./lib/glossary";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[glossary-roundtrip]";

// The generated id artifact — accept both the design (`src/ids.ts`) and the
// ADR/AGENTS (`ids.ts`) paths, whichever the §6.2 pipeline ends up emitting.
const IDS_CANDIDATES = ["packages/glossary/src/ids.ts", "packages/glossary/ids.ts"];

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

/** Extract the `GLOSSARY_IDS` object keys from the generated ids.ts source. */
function parseGeneratedIds(src: string): Set<string> {
  const ids = new Set<string>();
  const objMatch = src.match(/GLOSSARY_IDS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!objMatch) return ids;
  const body = objMatch[1];
  const KEY_RE = /(?:^|[\s,{])([a-z][a-z0-9_]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = KEY_RE.exec(body)) !== null) ids.add(m[1]);
  return ids;
}

async function main(): Promise<void> {
  let idsRel: string | null = null;
  for (const cand of IDS_CANDIDATES) {
    if (await exists(resolve(REPO_ROOT, cand))) {
      idsRel = cand;
      break;
    }
  }

  // Real evaluated emptiness: no generated artifact → nothing to roundtrip.
  if (!idsRel) {
    info(
      `generated glossary id artifact not present (looked for ${IDS_CANDIDATES.join(", ")}) — ` +
        "nothing to roundtrip. Bites when the ADR-0006 §6.2 generator + committed ids.ts land.",
    );
    process.exit(0);
  }

  const { terms, skipped } = await readGlossarySource(REPO_ROOT);
  const sourceIds = new Set(terms.map((t) => t.id));
  const generatedIds = parseGeneratedIds(await readFile(resolve(REPO_ROOT, idsRel), "utf8"));

  for (const s of skipped) {
    info(`WARN: glossary source ${s} has no \`**Canonical id:**\` marker — excluded from the id set.`);
  }
  info(`glossary source ids: ${sourceIds.size}; generated ids (${idsRel}): ${generatedIds.size}.`);

  const missingFromGenerated: string[] = [];
  for (const id of sourceIds) if (!generatedIds.has(id)) missingFromGenerated.push(id);
  const orphanGenerated: string[] = [];
  for (const id of generatedIds) if (!sourceIds.has(id)) orphanGenerated.push(id);

  if (missingFromGenerated.length === 0 && orphanGenerated.length === 0) {
    info(`PASS — glossary source and generated ids are in lockstep (${sourceIds.size}).`);
    process.exit(0);
  }

  for (const id of missingFromGenerated.sort()) {
    process.stderr.write(`${TAG} missing from generated  \`${id}\` (in glossary source, not in ${idsRel})\n`);
  }
  for (const id of orphanGenerated.sort()) {
    process.stderr.write(`${TAG} orphan generated id  \`${id}\` (in ${idsRel}, no glossary source term)\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — glossary source ↔ generated ids out of lockstep ` +
      `(${missingFromGenerated.length} missing, ${orphanGenerated.length} orphan). ` +
      `Regenerate with \`pnpm generate:glossary\` and commit ${idsRel}, or reconcile the glossary source (ADR-0006 §6).\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
