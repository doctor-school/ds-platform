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
 * This is a pure parse-and-compare (a read/diff, no side effects): it does NOT
 * re-run the generator. The ADR-0006 §6.2 generator landed with #460 —
 * `packages/glossary/scripts/generate.ts`, run via `pnpm generate:glossary`,
 * emits the committed `packages/glossary/src/ids.ts` (`GLOSSARY_IDS`, 4 ids
 * today). This guard diffs that committed artifact against the glossary source —
 * the `tokens-fresh` "generated artifact is committed + up to date" pattern — so
 * a stale `ids.ts` (generator not re-run) surfaces as drift, exit 1.
 *
 * ── Empty-state branch = DEFENSIVE handling (NOT the live state) ───────────────
 * On a real checkout the committed artifact is present (`packages/glossary/src/ids.ts`)
 * and the guard runs the real source↔generated diff. The branch below that reports
 * "generated artifact not present — nothing to roundtrip" (exit 0) when the SCAN
 * finds no artifact is retained as DEFENSIVE handling for a not-yet-generated tree;
 * it is exercised only by the fixture test (`LINT_FIXTURE_ROOT` no-artifact case),
 * not production reality. Kept because it is a real evaluated code path, not a stub.
 *
 * ── Posture (recorded on the ci.yml job header) ───────────────────────────────
 * KEPT hard-red (BLOCK, in the `ci` needs-list). It is a deterministic pure
 * set comparison with no false-positive class, and clean (in lockstep) on `main`.
 * ADR-0006 §7.0 phases roundtrip into the Pilot tier — that phasing addressed
 * FALSE-POSITIVE / overhead noise, which a symmetric id-set diff cannot produce;
 * it can only fire on a genuine source↔generated drift, which is worth blocking.
 * So the deterministic + clean criterion wins over the Pilot phasing here.
 * (Contrast glossary-mdx, burned in for genuine `[[…]]` namespace ambiguity.)
 *
 * ── Artifact path (design vs ADR/AGENTS) ──────────────────────────────────────
 * The artifact of record is `packages/glossary/src/ids.ts` — what the §6.2
 * generator emits and AGENTS.md §8 cites. The ADR-0006 §6 body reconcile (#459)
 * settled the format-and-path split; the guard still accepts both `src/ids.ts`
 * and the bare `packages/glossary/ids.ts` path defensively, so it works
 * whichever path the pipeline emits.
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

  // Defensive empty-state branch (not the live state — the committed artifact
  // exists on a real checkout): no generated artifact found → nothing to roundtrip.
  if (!idsRel) {
    info(
      `generated glossary id artifact not present (looked for ${IDS_CANDIDATES.join(", ")}) — ` +
        "nothing to roundtrip. Defensive path for a not-yet-generated tree; normally the " +
        "committed src/ids.ts is present and gets the real source↔generated diff.",
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
