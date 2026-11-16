/**
 * tools/lint/lib/ears-tests.ts — EARS id ↔ test-title matching, shared by
 * `ears-test-lint.ts` (spec id ↔ test coverage) and `scenario-proof-lint.ts`
 * (a scenario's `@proof:<level>` claim). The semantics are documented once, in
 * the `ears-test-lint.ts` header: ids come from `it`/`test`/`describe` TITLES
 * only, a compound `EARS-N/M` splits, two ids match by component-wise
 * dotted-prefix ancestry, and a test file's feature scope is any `NNN EARS-…`
 * title opener (validated against the real feature dirs by the caller).
 */

/** An EARS id is flat or arbitrarily-nested: EARS-N, EARS-N.M, EARS-N.M.K … */
export const EARS_ID_RE = /\bEARS-\d+(?:\.\d+)*\b/g;
/** A test-title token: an id, or the compound `EARS-N/M` form (split by `expandToken`). */
const EARS_TOKEN_RE = /\bEARS-\d+(?:[./]\d+)*\b/g;
/** `it(` / `test(` / `describe(` title — the first string-literal argument. */
const TITLE_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])([\s\S]*?)\1/g;
/**
 * A title that STARTS with `NNN EARS-…` declares the file's owning feature. The
 * leading-quote anchor also sees a chained `describe.skipIf(…)("NNN EARS-…")`
 * header TITLE_RE misses, and ignores a mid-prose `(004 EARS-6)` cross-reference.
 */
const FEATURE_SCOPE_RE = /['"`](\d{3})\s+EARS-\d/g;
/** The feature number `NNN` of a spec file lives in its `.../features/NNN-<slug>/…` path. */
const SPEC_FEATURE_RE = /specs\/features\/(\d+)-/;

/** The test files both guards read (repo-relative globs + ignores for fast-glob). */
export const TEST_FILE_GLOBS = [
  "apps/**/*.test.{ts,tsx}",
  "apps/**/*.spec.{ts,tsx}",
  "apps/**/*.e2e-spec.{ts,tsx}",
  "packages/**/*.test.{ts,tsx}",
  "packages/**/*.spec.{ts,tsx}",
];
export const TEST_FILE_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.turbo/**",
  "**/coverage/**",
];

/** Expand a title token into its component flat/nested ids (`EARS-25/16` → 25, 16). */
export function expandToken(token: string): string[] {
  const body = token.slice("EARS-".length);
  return body.split("/").map((p) => `EARS-${p}`);
}

/** Numeric dotted components of an id: `EARS-18.1` → [18, 1]. */
function components(id: string): number[] {
  return id
    .slice("EARS-".length)
    .split(".")
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
export function matches(idA: string, idB: string): boolean {
  const a = components(idA);
  const b = components(idB);
  return isPrefix(a, b) || isPrefix(b, a);
}

/** The `NNN` feature number of a spec file, from its `.../features/NNN-<slug>/…` path. */
export function specFeature(relPath: string): string | null {
  return relPath.replace(/\\/g, "/").match(SPEC_FEATURE_RE)?.[1] ?? null;
}

/** A title token, with the `NNN ` written directly before it when there is one. */
const PREFIXED_TOKEN_RE = /(?:\b(\d{3})\s+)?\bEARS-\d+(?:[./]\d+)*\b/g;

/** One EARS id cited in one test title; `feature` = its own `NNN ` prefix, if any. */
export interface EarsOccurrence {
  id: string;
  feature: string | null;
}

/**
 * EARS ids cited in a test file's `it`/`test`/`describe` TITLES, plus the raw
 * feature scope — every `NNN` whose title opens with `NNN EARS-…` (empty =
 * feature-agnostic). The caller keeps only the numbers of real feature dirs.
 * `occurrences` lists every id per title with its own prefix, for a caller that
 * must not let one spec's title stand in for another's (`ids`/`features` pool
 * the whole file, the `ears-test-lint` semantics).
 */
export function parseTestTitles(text: string): {
  ids: Set<string>;
  features: Set<string>;
  occurrences: EarsOccurrence[];
} {
  const ids = new Set<string>();
  const features = new Set<string>();
  const occurrences: EarsOccurrence[] = [];
  for (const title of text.matchAll(TITLE_RE)) {
    for (const tok of title[2].matchAll(EARS_TOKEN_RE)) {
      for (const id of expandToken(tok[0])) ids.add(id);
    }
    for (const tok of title[2].matchAll(PREFIXED_TOKEN_RE)) {
      const token = tok[0].slice(tok[0].indexOf("EARS-"));
      for (const id of expandToken(token)) {
        occurrences.push({ id, feature: tok[1] ?? null });
      }
    }
  }
  for (const fm of text.matchAll(FEATURE_SCOPE_RE)) features.add(fm[1]);
  return { ids, features, occurrences };
}
