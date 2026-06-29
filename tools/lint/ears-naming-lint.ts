#!/usr/bin/env tsx
/**
 * tools/lint/ears-naming-lint.ts — WARN guard for EARS test-NAME format hygiene
 * (the FORMAT direction of the bidirectional EARS↔test contract; #316).
 *
 * Spec/ADR: ADR-0006 §4 (EARS↔test naming convention) + ADR-0007 §2.6 (WARN
 * nudges). Companion: `ears-test-lint.ts` owns the COVERAGE + ORPHAN directions
 * (forward: every requirement has a test; backward: no test cites a non-existent
 * requirement). This guard owns the third concern: a test that *intends* to be an
 * EARS test must spell the id correctly.
 *
 * Why this exists (#316 / the #119 retro): the EARS naming rule `it('EARS-N: …')`
 * lived only as prose. The bidirectional traceability standard says only
 * requirement-level tests carry an id — unit tests against implementation detail
 * legitimately do NOT (forcing an id onto them is the "high code coverage, low
 * requirements coverage" anti-pattern). So this guard does NOT demand every test be
 * EARS-named (that would flood WARN noise on legit unit / `#issue`-regression
 * tests). It flags only a MALFORMED attempt: a title that clearly tries the EARS
 * prefix but breaks the canonical shape — `ears-3:` (lowercase), `EARS3:` (no
 * hyphen), `EARS-3` (no colon), `EARS 3:` (space for hyphen). A plain non-EARS
 * title is left untouched; the COVERAGE guard catches a genuinely missing test.
 *
 * Canonical EARS title prefix (all real corpus shapes accepted): `EARS-N:`,
 * nested `EARS-N.M:`, compound `EARS-N/M:` (one test covering two sibling
 * requirements), each optionally annotated `EARS-N (#issue):`.
 *
 * Scope: `it(` / `test(` / `describe(` titles across the app + package test suites.
 * Because only EARS *attempts* are flagged, a non-EARS unit test is never touched —
 * the guard is self-scoping to "titles that meant to be EARS". A file may opt out
 * with a reasoned `/* ears-naming-ok: <reason> *\/`.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6), `continue-on-error` CI job; promote to
 * BLOCK once stable. Run: `pnpm lint:ears-naming`. Violations: stderr + exit 1.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG = '[ears-naming]';

const TEST_GLOBS = [
  'apps/**/*.test.{ts,tsx}',
  'apps/**/*.spec.{ts,tsx}',
  'apps/**/*.e2e-spec.{ts,tsx}',
  'packages/**/*.test.{ts,tsx}',
  'packages/**/*.spec.{ts,tsx}',
];
const IGNORE = ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'];

const SUPPRESS_RE = /ears-naming-ok:\s*\S/;

// `it(` / `test(` / `describe(` title — the first string-literal argument.
const TITLE_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])([\s\S]*?)\1/g;

// A title that *attempts* the EARS prefix: starts with `ears` followed by a
// hyphen / space / colon / digit (so prose like "earshot" is not a false attempt).
const ATTEMPT_RE = /^\s*ears[-\s:0-9]/i;
// The canonical, correctly-spelled prefix: uppercase EARS, hyphen, flat/nested/
// compound id, optional `(#issue)` annotation, then a colon.
const CANONICAL_RE = /^\s*EARS-\d+(?:[./]\d+)*(?:\s*\(#\d+\))?:/;

interface Violation {
  file: string;
  title: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Strip JS/TS comments so a commented-out malformed example is not flagged. */
function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function main(): void {
  const files = fg.sync(TEST_GLOBS, { cwd: REPO_ROOT, ignore: IGNORE, absolute: false });
  const violations: Violation[] = [];
  let scanned = 0;

  for (const file of files) {
    const raw = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    if (SUPPRESS_RE.test(raw)) continue;
    const src = stripJsComments(raw);
    scanned++;

    for (const m of src.matchAll(TITLE_RE)) {
      const title = m[2];
      if (ATTEMPT_RE.test(title) && !CANONICAL_RE.test(title)) {
        violations.push({ file, title: title.slice(0, 80) });
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write(`${TAG} ${violations.length} malformed EARS test-name(s):\n`);
    for (const v of violations) {
      process.stderr.write(
        `${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, '/')}: "${v.title}" — not the canonical \`EARS-N:\` / \`EARS-N.M:\` / \`EARS-N/M:\` (optional \` (#issue)\`) shape. Fix the prefix or, for a genuine non-EARS test, drop the EARS-looking prefix (ADR-0006 §4). Reasoned opt-out: /* ears-naming-ok: <reason> */.\n`,
      );
    }
    process.exit(1);
  }

  info(`OK — ${scanned} test file(s); every EARS-prefixed title is canonical.`);
  process.exit(0);
}

main();
