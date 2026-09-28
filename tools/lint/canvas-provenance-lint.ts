#!/usr/bin/env tsx
/**
 * canvas-provenance — BLOCK guard (Issue #2389, ADR-0007 §2.6, ADR-0013).
 *
 * Every vendored Claude Design canvas `design-source/**\/*.dc.html` (archive
 * included) must carry an entry in `design-source/manifest.json` whose sha256
 * equals the file bytes, and every entry must name a file that exists. The one
 * writer of that manifest is `pnpm design:vendor` (tools/design/vendor-canvas.mjs),
 * run on the bytes of a DesignSync `get_file` pull; this guard is its `--check`.
 *
 * Honest limit: the guard proves «manifest and bytes agree and the vendoring
 * was an explicit recorded act»; it cannot prove the bytes came from Claude
 * Design without network. What makes a code-side canvas edit impossible to
 * merge inside a UI PR is ui-parity's co-edit BLOCK (a canvas and render-capable
 * UI never share a PR) together with its base-ref canvas read.
 *
 * Static tree scan — no PR context; runs in `pnpm pr:preflight --static`, in
 * PR-number preflight, and as a plain step of the CI `guards-block` job.
 * Seam: `LINT_FIXTURE_ROOT` points the scan at a fixture tree.
 */
import {
  MANIFEST_REL,
  checkProvenance,
  listCanvases,
  repoRoot,
} from "../design/vendor-canvas.mjs";

const TAG = "[canvas-provenance]";
const root = repoRoot();
const verdict = checkProvenance(root);
if (!verdict.ok) {
  for (const problem of verdict.problems)
    process.stderr.write(`${TAG} ${problem}\n`);
  process.stderr.write(
    `${TAG} canvas changes happen in Claude Design → DesignSync pull → \`pnpm design:vendor\` in a design-source-only vendoring PR (AGENTS.md §6, #2389).\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `${TAG} ${listCanvases(root).length} vendored canvases match ${MANIFEST_REL}\n`,
);
