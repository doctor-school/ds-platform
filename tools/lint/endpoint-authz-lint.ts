#!/usr/bin/env tsx
/**
 * tools/lint/endpoint-authz-lint.ts — endpoint-authorization completeness gate.
 *
 * Spec: apps/docs/content/specs/tech/2026-05-18-ds-platform-endpoint-authorization-matrix-design-en.md §6.
 * ADR:  ADR-0001 §2.5 ("missing metadata → CI fail"), ADR-0002 §3.2.1,
 *       engineering-readiness §3 (named pre-pilot security BLOCKER).
 *
 * This is the Layer-2 PRIMARY gate and is **BLOCK** (a deliberate exception to
 * ADR-0007 §2.6's Phase-0 WARN posture — §6.3): both authoritative sources
 * mandate hard failure. It is vacuously green when there are no routes to
 * classify, so it never impedes the Phase-0 bootstrap.
 *
 * What it does (§6.1):
 *   1. Boot a Nest application *context* (no listen) and enumerate every
 *      registered route via DiscoveryService + MetadataScanner — the
 *      authoritative route set, internal/excluded-from-OpenAPI routes
 *      included (§2.1). That boot lives in apps/api (`scanRealRouteSet`), so
 *      this root script needs no @nestjs/* dependency of its own.
 *   2. Validate completeness + validity of each route's @Authz metadata (§6.2).
 *   3. Modes:
 *      - default (check): fail on any violation; also fail if the committed
 *        matrix .md has drifted from a fresh regeneration.
 *      - --generate: write apps/api/docs/endpoint-authz-matrix.md.
 *
 * The matrix is generated, never authoritative (§5): the gate reads the Layer-1
 * metadata directly, so the .md cannot become a second source of truth.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { renderMatrix } from "../../apps/api/src/authz/authz.matrix.js";
import { scanRealRouteSet } from "../../apps/api/src/authz/authz.gate.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX_PATH = resolve(REPO_ROOT, "apps/api/docs/endpoint-authz-matrix.md");
const TAG = "[endpoint-authz]";

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}
function fail(msg: string): void {
  process.stderr.write(`${TAG} ${msg}\n`);
}

async function format(raw: string): Promise<string> {
  const cfg = await prettier.resolveConfig(MATRIX_PATH);
  return prettier.format(raw, { ...cfg, filepath: MATRIX_PATH });
}

async function readCommitted(): Promise<string | null> {
  try {
    return await readFile(MATRIX_PATH, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const generate = process.argv.includes("--generate");

  const { rows, violations } = await scanRealRouteSet();
  info(`scanned ${rows.length} classified route(s) over the real router`);

  if (violations.length > 0) {
    fail(`${violations.length} authorization-metadata violation(s):`);
    for (const v of violations) fail(`  • ${v}`);
    fail(
      "Every route must carry complete, valid @Authz metadata (spec §6.2). Fix the handler(s) above.",
    );
    process.exit(1);
  }

  const expected = await format(renderMatrix(rows));

  if (generate) {
    await mkdir(dirname(MATRIX_PATH), { recursive: true });
    await writeFile(MATRIX_PATH, expected, "utf8");
    info(`wrote ${rows.length} row(s) → apps/api/docs/endpoint-authz-matrix.md`);
    process.exit(0);
  }

  // check mode — drift gate (§5): committed .md must match a fresh regeneration.
  const committed = await readCommitted();
  if (committed === null) {
    fail(
      "apps/api/docs/endpoint-authz-matrix.md is missing. Run: pnpm lint:endpoint-authz --generate",
    );
    process.exit(1);
  }
  if (committed !== expected) {
    fail(
      "apps/api/docs/endpoint-authz-matrix.md is stale (drift). Regenerate: pnpm lint:endpoint-authz --generate",
    );
    process.exit(1);
  }

  info(`OK — ${rows.length} route(s) classified, matrix in sync`);
  process.exit(0);
}

main().catch((e) => {
  fail(`unexpected error: ${(e as Error).stack ?? String(e)}`);
  process.exit(1);
});
