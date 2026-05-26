#!/usr/bin/env tsx
/**
 * tools/lint/ears-test-lint.ts — WARN guard for EARS-ID test coverage.
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §5
 * ADR:  apps/docs/content/adr/0007-ai-stack-en.md §2.6 (CI nudges for humans).
 *
 * Scans `apps/docs/content/specs/features/<slug>/<NNN>-requirements.md` for
 * EARS-N.M identifiers, then scans `apps/**\/*.test.{ts,tsx}` and
 * `packages/**\/*.test.{ts,tsx}` for the same IDs. Emits warnings on:
 *   - EARS IDs in specs not referenced by any test (uncovered)
 *   - EARS IDs referenced in tests but absent from all specs (orphan)
 *
 * Always exits 0 (WARN v1). Empty-state graceful: no specs → skip cleanly.
 */
import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG = '[ears-test]';

const EARS_RE = /\bEARS-\d+\.\d+\b/g;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}
function warn(msg: string): void {
  process.stdout.write(`${TAG} WARN: ${msg}\n`);
}

async function extractIds(file: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(EARS_RE)) ids.add(m[0]);
  } catch (e) {
    warn(`could not read ${relative(REPO_ROOT, file)}: ${(e as Error).message.split('\n')[0]}`);
  }
  return ids;
}

async function main(): Promise<void> {
  const specFiles = await fg('apps/docs/content/specs/features/*/*-requirements.md', {
    cwd: REPO_ROOT,
    absolute: true,
  });

  if (specFiles.length === 0) {
    info('no specs found (apps/docs/content/specs/features/*/*-requirements.md), skipping');
    process.exit(0);
  }

  // specId → list of spec files where it appears
  const specIds = new Map<string, string[]>();
  for (const f of specFiles) {
    const ids = await extractIds(f);
    for (const id of ids) {
      const list = specIds.get(id) ?? [];
      list.push(relative(REPO_ROOT, f));
      specIds.set(id, list);
    }
  }
  info(`scanned ${specFiles.length} spec file(s), found ${specIds.size} unique EARS ID(s)`);

  const testFiles = await fg(['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}'], {
    cwd: REPO_ROOT,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'],
  });

  // testId → list of test files where it appears
  const testIds = new Map<string, string[]>();
  for (const f of testFiles) {
    const ids = await extractIds(f);
    for (const id of ids) {
      const list = testIds.get(id) ?? [];
      list.push(relative(REPO_ROOT, f));
      testIds.set(id, list);
    }
  }
  info(`scanned ${testFiles.length} test file(s), found ${testIds.size} unique EARS reference(s)`);

  let warnings = 0;

  // Uncovered: in spec, not in any test
  for (const [id, specs] of specIds) {
    if (!testIds.has(id)) {
      warn(`${id} declared in ${specs.join(', ')} but no test references it`);
      warnings++;
    }
  }

  // Orphan: in test, not in any spec
  for (const [id, tests] of testIds) {
    if (!specIds.has(id)) {
      warn(`Orphan EARS reference ${id} in test(s) ${tests.join(', ')} (not declared in any spec)`);
      warnings++;
    }
  }

  if (warnings === 0) {
    info('all EARS IDs have matching tests, no orphans');
  } else {
    info(`${warnings} warning(s) emitted`);
  }
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  // WARN guard: even unexpected error shouldn't fail CI.
  process.exit(0);
});
