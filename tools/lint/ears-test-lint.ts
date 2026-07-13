#!/usr/bin/env tsx
/**
 * tools/lint/ears-test-lint.ts — EARS-ID ↔ test traceability guard
 * (the FORWARD + ORPHAN direction of the bidirectional contract).
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §5
 * ADR:  ADR-0007 §2.6 (CI nudges → promotion clock) + ADR-0006 §4 (EARS↔test
 *       naming, the SSOT traceability convention). Companion: `ears-naming-lint.ts`
 *       (#316) owns the FORMAT-hygiene direction (a malformed `EARS-…` prefix).
 *
 * Industry grounding (#316): requirements↔test traceability is **bidirectional**
 * — forward (every requirement has a test) + backward (no orphan test cites a
 * non-existent requirement). This guard owns both *coverage* directions; only
 * requirement-level tests carry an EARS id (unit tests against implementation
 * detail legitimately do not — they are not flagged here).
 *
 * Reads EARS ids from `it(…)` / `test(…)` / `describe(…)` **titles only** (not
 * arbitrary file text), so a fixture datum like `tests: ["EARS-99"]` or an
 * assertion string is not mistaken for a traceability reference. Accepts every
 * real id shape: flat `EARS-N`, nested `EARS-N.M`, and the compound `EARS-N/M`
 * (one test covering two requirements — split into `EARS-N` + `EARS-M`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NESTED-ID FOLDING SEMANTICS (#437, grounded in ADR-0006 §4)
 * ─────────────────────────────────────────────────────────────────────────────
 * ADR-0006 §4 mandates flat `EARS-N` numbering by default and legitimizes nested
 * `EARS-N.M` **only** when a single handler carries multiple shall-clauses (e.g.
 * `EARS-3.1` upsert + `EARS-3.2` emit). A flat `EARS-N` and its nested children
 * `EARS-N.M` therefore describe the SAME handler at different granularities, and a
 * test at either granularity legitimately traces to the requirement at the other.
 * So the guard matches a spec id and a test id by **component-wise dotted-prefix
 * ancestry**, not string equality:
 *
 *   match(A, B) ⇔ A == B, OR one id's dotted-number path is a prefix of the other's
 *   (compared component-by-component so `EARS-1` never folds into `EARS-18`).
 *
 *   - A FLAT spec `EARS-18` is covered by any nested test `EARS-18.M` (a nested
 *     test subdividing a flat requirement still tests it). Symmetrically the
 *     nested test is not an orphan.
 *   - NESTED spec ids `EARS-1.1`, `EARS-1.2` are each covered by a FLAT test
 *     `EARS-1` (a whole-handler test exercises every shall-clause). Symmetrically
 *     the flat test is not an orphan.
 *   - A SIBLING nested id does NOT cover its sibling: spec `EARS-3.1` + `EARS-3.2`
 *     with only an `EARS-3.1` test leaves `EARS-3.2` a genuine uncovered finding
 *     (neither is a prefix of the other). This is the guard-rail against folding
 *     away real gaps.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPEC-SCOPED DEFERRALS (#612, grounded in ADR-0006 §4)
 * ─────────────────────────────────────────────────────────────────────────────
 * EARS numbering is flat **per feature-spec**, so an id like `EARS-4` is only
 * unique *within* a spec — feature 003 (registration verify) and feature 007
 * (publish transition) each own a distinct, unrelated `EARS-4`. The forward
 * COVERAGE + ORPHAN directions stay in a single global id keyspace on purpose:
 * an `EARS-N` requirement declared in several specs (a cross-feature id, or a
 * cross-reference the whole-doc scan picks up) is satisfied by any `EARS-N` test,
 * exactly as before. Splitting forward-coverage per feature is not just noisier —
 * it is **unsatisfiable** for the acceptance contract: 007's `EARS-4` is uncovered
 * on `main` (its test ships later) yet covered on that later branch, so no single
 * static deferral list could keep both green.
 *
 * The DEFERRAL allowlist, by contrast, IS spec-scoped — that is where the collision
 * actually bites. A deferral key is `feature:id` (e.g. `003:EARS-4`); its coverage
 * and staleness are resolved only against tests whose feature scope is COMPATIBLE
 * with the deferral's feature. A test file's feature scope is any `NNN EARS-…`
 * prefix in its `it`/`test`/`describe` titles (e.g. `describe("007 EARS-4 …")`
 * scopes the whole file to 007), validated against the real feature-spec dirs so a
 * stray `#222 EARS-13` Issue reference is not mistaken for a scope. A file with no
 * such prefix is feature-agnostic. A deferral and a test file are scope-compatible
 * when either side is agnostic or the file carries the deferral's feature — so a
 * 007-scoped `EARS-4` test can neither satisfy nor stale-flag the 003 `EARS-4`
 * deferral (the #612 defect), while a legacy bare (agnostic) deferral key still
 * behaves globally as before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEFERRAL ALLOWLIST (#437, spec-scoped #612)
 * ─────────────────────────────────────────────────────────────────────────────
 * A requirement whose real test genuinely cannot be added cheaply (needs a live
 * dependency, or an unbuilt future path) is an accepted, TRACKED deferral — NOT a
 * silent gap (AGENTS.md §6 "no untracked seam"). Each deferral is an entry in
 * `BUILTIN_DEFERRALS` mapping a spec-scoped `feature:id` key (e.g. `003:EARS-4`)
 * to an OPEN tracking Issue + a reason; the guard reports it as an `info:` line
 * (referencing the Issue) instead of a finding, so `main` runs clean while the
 * obligation stays visible. If the deferred requirement later becomes covered by
 * a scope-compatible test, the guard flags the entry as **stale** (a finding) so
 * the allowlist is pruned — the ratchet only tightens. A legacy **bare** key
 * (`EARS-4`, no `feature:` prefix) is still accepted and treated as agnostic.
 * The `LINT_EARS_DEFERRALS` env seam replaces this map for deterministic tests.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXIT CONTRACT (#437): exits **non-zero (1) on any finding** — the WARN→BLOCK
 * promotion prerequisite (ADR-0007 §2.6). Exits 0 when there are no findings and
 * on the empty-state (no specs). An unexpected internal error also exits 1 (fail
 * loud). The CI job keeps `continue-on-error: true` until the §2.6 sweep flips it.
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
// A test file's OWNING feature is declared by a title that STARTS with a
// `NNN EARS-…` prefix (e.g. `describe.skipIf(cond)("007 EARS-4 publish …")`). The
// leading-quote anchor (a) captures the title even under a chained `.skipIf(…)` /
// `.each(…)` the generic TITLE_RE misses, and (b) ignores a mid-prose/comment
// cross-reference like `(004 EARS-6)` which is not a title opener. See the
// SPEC-SCOPED DEFERRALS header. Scanned over the whole file, not per-title.
const FEATURE_SCOPE_RE = /['"`](\d{3})\s+EARS-\d/g;
// The feature number `NNN` of a spec file lives in its `.../features/NNN-<slug>/…` path.
const SPEC_FEATURE_RE = /specs\/features\/(\d+)-/;

interface Deferral {
  issue: number;
  reason: string;
}

/**
 * Deferral allowlist — EARS ids whose real test genuinely cannot be added cheaply,
 * each tracked by an OPEN Issue. Keep this list SHORT and prune stale entries.
 *
 * - EARS-4 (003): "registration verification is email-only; phone verification is a
 *   FUTURE post-registration secondary-identifier path" — a negative/scoping
 *   requirement. Its positive counterpart (email-only verify) is exercised by the
 *   EARS-2/EARS-3 e2e; its own testable path (the future secondary-phone verify)
 *   is unbuilt and would need live Zitadel. Tracked in #454 (sub-issue of the 003
 *   auth post-v1 backlog #220). Prune this entry once the secondary-phone verify
 *   path lands with its own `EARS-4` test.
 *
 * - EARS-27 / EARS-28 (003): the account-profile v1 spec increment (GH #770)
 *   merged spec-first per the SDD sequencing contract (a code PR cannot precede
 *   its spec on `main` — the spec-link BLOCK guard). The tests land with the #770
 *   implementation slice (`apps/api/test/me/profile.e2e-spec.ts` + the browser
 *   drive). Prune both entries when that PR merges — the stale-detection ratchet
 *   flags them the moment a scope-compatible test appears.
 */
const BUILTIN_DEFERRALS: Record<string, Deferral> = {
  '003:EARS-4': {
    issue: 454,
    reason:
      'registration verify is email-only; the future secondary-phone verify path is unbuilt (needs live Zitadel)',
  },
  '003:EARS-27': {
    issue: 770,
    reason:
      'spec-first increment (SDD ordering); the GET /v1/me/profile e2e lands with the #770 implementation slice',
  },
  '003:EARS-28': {
    issue: 770,
    reason:
      'spec-first increment (SDD ordering); the /account browser verification lands with the #770 implementation slice',
  },
};

function loadDeferrals(): Record<string, Deferral> {
  const raw = process.env.LINT_EARS_DEFERRALS;
  if (!raw) return BUILTIN_DEFERRALS;
  try {
    return JSON.parse(raw) as Record<string, Deferral>;
  } catch (e) {
    warn(`ignoring malformed LINT_EARS_DEFERRALS: ${(e as Error).message.split('\n')[0]}`);
    return BUILTIN_DEFERRALS;
  }
}

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

/** Numeric dotted components of an id: `EARS-18.1` → [18, 1]. */
function components(id: string): number[] {
  return id
    .slice('EARS-'.length)
    .split('.')
    .map((n) => Number.parseInt(n, 10));
}

/** True iff `a` is a component-wise prefix of `b` (equal length counts). */
function isPrefix(a: number[], b: number[]): boolean {
  if (a.length > b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Fold-match: two ids trace to the same requirement iff one is a dotted-prefix
 * ancestor of the other (or they are equal). Component-wise, so `EARS-1` (=[1])
 * never matches `EARS-18` (=[18]).
 */
function matches(idA: string, idB: string): boolean {
  const a = components(idA);
  const b = components(idB);
  return isPrefix(a, b) || isPrefix(b, a);
}

/** The `NNN` feature number of a spec file, from its `.../features/NNN-<slug>/…` path. */
function specFeature(relPath: string): string | null {
  return relPath.replace(/\\/g, '/').match(SPEC_FEATURE_RE)?.[1] ?? null;
}

/** Parse a deferral allowlist key into `{ feature, id }` — bare `EARS-N` → agnostic. */
function parseDeferralKey(key: string): { feature: string | null; id: string } {
  const idx = key.indexOf(':');
  if (idx === -1) return { feature: null, id: key };
  return { feature: key.slice(0, idx), id: key.slice(idx + 1) };
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

/**
 * EARS ids cited in a test file's `it`/`test`/`describe` TITLES, plus the file's
 * feature scope — the set of `NNN` numbers whose title opens with a `NNN EARS-…`
 * prefix (empty = feature-agnostic). The feature scan runs over the whole file so
 * it also sees a `describe.skipIf(cond)("NNN EARS-… ")` header the per-title
 * TITLE_RE cannot; the leading-quote anchor keeps comment cross-refs out.
 */
async function extractTest(file: string): Promise<{ ids: Set<string>; features: Set<string> }> {
  const ids = new Set<string>();
  const features = new Set<string>();
  try {
    const text = await readFile(file, 'utf8');
    for (const title of text.matchAll(TITLE_RE)) {
      for (const tok of title[2].matchAll(EARS_TOKEN_RE)) {
        for (const id of expandToken(tok[0])) ids.add(id);
      }
    }
    for (const fm of text.matchAll(FEATURE_SCOPE_RE)) features.add(fm[1]);
  } catch (e) {
    warn(`could not read ${relative(REPO_ROOT, file)}: ${(e as Error).message.split('\n')[0]}`);
  }
  return { ids, features };
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

  // Forward COVERAGE + ORPHAN stay in a single global id keyspace (see the
  // SPEC-SCOPED DEFERRALS header for why per-feature forward-coverage is
  // unsatisfiable here). `knownFeatures` is the set of real feature-spec dir
  // numbers — a test-title `NNN` prefix only counts as a feature scope if it is
  // one of these, so a stray `#222 EARS-13` Issue reference is not read as a scope.
  const specIds = new Map<string, string[]>();
  const knownFeatures = new Set<string>();
  for (const f of specFiles) {
    const rel = relative(REPO_ROOT, f);
    const feature = specFeature(rel);
    if (feature) knownFeatures.add(feature);
    for (const id of await extractSpecIds(f)) {
      const list = specIds.get(id) ?? [];
      list.push(rel);
      specIds.set(id, list);
    }
  }
  info(`scanned ${specFiles.length} spec file(s), found ${specIds.size} unique EARS ID(s)`);

  // Widened from `*.test.{ts,tsx}` to also cover `*.spec.ts` and the api
  // `*.e2e-spec.ts` suites — that is where the handler tests actually live, so the
  // prior glob saw none of them and every requirement looked uncovered (#316).
  // The `*.spec.{ts,tsx}` arm also catches the portal Playwright `*.e2e.spec.ts`
  // files, so a `user-facing` requirement's E2E coverage (ADR-0006 §4) counts.
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

  // Per-file test entries: the ids cited in its titles + its validated feature
  // scope (the `NNN EARS-…` title prefixes that name a real feature-spec dir).
  // `testIds` (global id → files) drives the forward/orphan directions unchanged;
  // the per-file feature scope is consulted ONLY by the spec-scoped deferral logic.
  const testIds = new Map<string, string[]>();
  const testEntries: { rel: string; ids: Set<string>; features: Set<string> }[] = [];
  for (const f of testFiles) {
    const rel = relative(REPO_ROOT, f);
    const { ids, features } = await extractTest(f);
    const scoped = new Set([...features].filter((n) => knownFeatures.has(n)));
    testEntries.push({ rel, ids, features: scoped });
    for (const id of ids) {
      const list = testIds.get(id) ?? [];
      list.push(rel);
      testIds.set(id, list);
    }
  }
  info(`scanned ${testFiles.length} test file(s), found ${testIds.size} unique EARS reference(s)`);

  const testIdList = [...testIds.keys()];
  const specIdList = [...specIds.keys()];
  const deferralList = Object.entries(loadDeferrals()).map(([key, d]) => {
    const { feature, id } = parseDeferralKey(key);
    // `label` = the scoped `feature:id` key, or the bare id for a legacy agnostic entry.
    return { feature, id, label: feature ? key : id, ...d };
  });

  /** Some test id fold-matches this spec id (covered — global keyspace). */
  const isCovered = (specId: string): boolean => testIdList.some((t) => matches(specId, t));
  /** Some spec id fold-matches this test id (declared → not an orphan — global keyspace). */
  const isDeclared = (testId: string): boolean => specIdList.some((s) => matches(testId, s));
  /**
   * A deferral is "really covered" when some test whose FILE scope is compatible
   * with the deferral's feature fold-matches the deferred id. A file is compatible
   * when the deferral is agnostic, the file is agnostic (no scope), or the file
   * carries the deferral's feature. So a 007-scoped test never covers `003:EARS-4`.
   */
  const deferralCovered = (feature: string | null, id: string): boolean =>
    testEntries.some(
      (e) =>
        (feature === null || e.features.size === 0 || e.features.has(feature)) &&
        [...e.ids].some((tid) => matches(id, tid)),
    );

  let findings = 0;

  // Forward: declared in a spec, cited (foldably) by no test title. A deferred id is
  // resolved scope-aware — a scope-incompatible test (e.g. 007's EARS-4) does not
  // satisfy the 003 deferral, so its `info:` line still prints and the obligation
  // stays visible even while another spec's same-numbered id is genuinely covered.
  for (const [id, specs] of specIds) {
    const deferral = deferralList.find((d) => d.id === id);
    if (deferral) {
      // Covered-by-compatible-test is handled by the stale loop below; either way
      // this is not an uncovered finding.
      if (!deferralCovered(deferral.feature, id)) {
        info(`deferred: ${deferral.label} uncovered — tracked in #${deferral.issue} (${deferral.reason})`);
      }
      continue;
    }
    if (isCovered(id)) continue;
    warn(`${id} declared in ${specs.join(', ')} but no test title references it`);
    findings++;
  }

  // Stale allowlist: a deferred id is now covered by a scope-compatible test → prune it.
  for (const d of deferralList) {
    if (deferralCovered(d.feature, d.id)) {
      warn(
        `stale deferral: ${d.label} is now covered by a test — remove it from the ` +
          `ears-test-lint allowlist (#${d.issue})`,
      );
      findings++;
    }
  }

  // Backward: cited in a test title, declared (foldably) by no spec (orphan — global).
  for (const [id, tests] of testIds) {
    if (!isDeclared(id)) {
      warn(`Orphan EARS reference ${id} in test(s) ${tests.join(', ')} (not declared in any spec)`);
      findings++;
    }
  }

  if (findings === 0) {
    info('all EARS IDs have matching tests, no orphans');
    process.exit(0);
  }
  info(`${findings} finding(s) — failing (ADR-0007 §2.6 exit contract)`);
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
