#!/usr/bin/env tsx
/**
 * tools/lint/ears-test-lint.ts — WARN guard for EARS-ID ↔ test traceability
 * (the FORWARD + ORPHAN direction of the bidirectional contract).
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §5
 * ADR:  ADR-0007 §2.6 (CI nudges for humans) + ADR-0006 §4 (EARS↔test naming,
 *       the SSOT traceability convention). Companion: `ears-naming-lint.ts` (#316)
 *       owns the FORMAT-hygiene direction (a malformed `EARS-…` prefix).
 *
 * Industry grounding (#316): requirements↔test traceability is **bidirectional**
 * — forward (every requirement has a test) + backward (no orphan test cites a
 * non-existent requirement). This guard owns both *coverage* directions; only
 * requirement-level tests carry an EARS id (unit tests against implementation
 * detail legitimately do not — they are not flagged here).
 *
 * Reads EARS ids from `it(…)` / `test(…)` / `describe(…)` **titles only** (not
 * arbitrary file text), so a fixture datum like `tests: ["EARS-99"]` or an
 * assertion string is not mistaken for a traceability reference. Emits warnings on:
 *   - an EARS id declared in a `NNN-requirements*.md` spec that no test title cites
 *     (uncovered requirement — the #119 class: a handler shipped with no EARS test)
 *   - an EARS id in a test title that no spec declares (orphan reference)
 *
 * Accepts every real id shape: flat `EARS-N`, nested `EARS-N.M`, and the compound
 * `EARS-N/M` (one test covering two requirements — split into `EARS-N` + `EARS-M`).
 *
 * Always exits 0 (WARN v1). Empty-state graceful: no specs → skip cleanly.
 */
import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// TEST SEAM: `LINT_FIXTURE_ROOT` points the scan at a fixture tree
// (tools/lint/guard-tests/fixtures/ears-test/<case>). Inert in production.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG = '[ears-test]';

// An EARS id is flat or arbitrarily-nested: EARS-N, EARS-N.M, EARS-N.M.K …
const EARS_ID_RE = /\bEARS-\d+(?:\.\d+)*\b/g;
// In a test TITLE an id may also appear in the compound `EARS-N/M` form (one test
// covering two sibling requirements). We capture the whole token, then split `/`.
const EARS_TOKEN_RE = /\bEARS-\d+(?:[./]\d+)*\b/g;
// `it(` / `test(` / `describe(` title — the first string-literal argument.
const TITLE_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])([\s\S]*?)\1/g;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}
function warn(msg: string): void {
  process.stdout.write(`${TAG} WARN: ${msg}\n`);
}

/** Expand a title token into its component flat/nested ids (`EARS-25/16` → 25, 16). */
function expandToken(token: string): string[] {
  // token = `EARS-<part>(/<part>)*` where each part is `N` or `N.M…`.
  const body = token.slice('EARS-'.length);
  return body.split('/').map((p) => `EARS-${p}`);
}

/** EARS ids declared in a requirements spec (whole-doc scan — specs are prose). */
async function extractSpecIds(file: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(EARS_ID_RE)) ids.add(m[0]);
  } catch (e) {
    warn(`could not read ${relative(REPO_ROOT, file)}: ${(e as Error).message.split('\n')[0]}`);
  }
  return ids;
}

/** EARS ids cited in a test file's `it`/`test`/`describe` TITLES only. */
async function extractTestIds(file: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const text = await readFile(file, 'utf8');
    for (const title of text.matchAll(TITLE_RE)) {
      for (const tok of title[2].matchAll(EARS_TOKEN_RE)) {
        for (const id of expandToken(tok[0])) ids.add(id);
      }
    }
  } catch (e) {
    warn(`could not read ${relative(REPO_ROOT, file)}: ${(e as Error).message.split('\n')[0]}`);
  }
  return ids;
}

async function main(): Promise<void> {
  // Spec glob covers the single-file `NNN-requirements.md` and the bilingual
  // product split `NNN-requirements-en.md` / `-ru.md` (same ids in each → the Set
  // dedupes), so a `user-facing` product spec is not invisible to traceability.
  const specFiles = await fg('apps/docs/content/specs/features/*/*-requirements*.md', {
    cwd: REPO_ROOT,
    absolute: true,
  });

  if (specFiles.length === 0) {
    info('no specs found (apps/docs/content/specs/features/*/*-requirements*.md), skipping');
    process.exit(0);
  }

  // specId → list of spec files where it appears
  const specIds = new Map<string, string[]>();
  for (const f of specFiles) {
    for (const id of await extractSpecIds(f)) {
      const list = specIds.get(id) ?? [];
      list.push(relative(REPO_ROOT, f));
      specIds.set(id, list);
    }
  }
  info(`scanned ${specFiles.length} spec file(s), found ${specIds.size} unique EARS ID(s)`);

  // Widened from `*.test.{ts,tsx}` to also cover `*.spec.ts` and the api
  // `*.e2e-spec.ts` suites — that is where the handler tests actually live, so the
  // prior glob saw none of them and every requirement looked uncovered (#316).
  const testFiles = await fg(
    [
      'apps/**/*.test.{ts,tsx}',
      'apps/**/*.spec.{ts,tsx}',
      'apps/**/*.e2e-spec.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'packages/**/*.spec.{ts,tsx}',
    ],
    {
      cwd: REPO_ROOT,
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'],
    },
  );

  // testId → list of test files where it appears
  const testIds = new Map<string, string[]>();
  for (const f of testFiles) {
    for (const id of await extractTestIds(f)) {
      const list = testIds.get(id) ?? [];
      list.push(relative(REPO_ROOT, f));
      testIds.set(id, list);
    }
  }
  info(`scanned ${testFiles.length} test file(s), found ${testIds.size} unique EARS reference(s)`);

  let warnings = 0;

  // Forward: declared in a spec, cited by no test title (uncovered requirement).
  for (const [id, specs] of specIds) {
    if (!testIds.has(id)) {
      warn(`${id} declared in ${specs.join(', ')} but no test title references it`);
      warnings++;
    }
  }

  // Backward: cited in a test title, declared by no spec (orphan reference).
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
