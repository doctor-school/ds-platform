/**
 * tools/lint/lib/glossary.ts — the async, tsx-run reader for the glossary
 * SOURCE-of-truth, used by the two ADR-0006 §6 glossary guards (glossary-mdx-lint,
 * glossary-roundtrip-lint).
 *
 * The source glob + ``**Canonical id:**`` body-marker parse live in ONE shared
 * primitive (`glossary-source.mjs`, #500) that both this reader and the ESLint
 * rule's id-set reader (`glossary-ids.mjs`) delegate to — a `.ts` module can
 * import a `.mjs`. This file keeps its async, Promise-returning public signatures
 * byte-for-byte stable for its `await`-ing guard callers; the underlying read is
 * synchronous (the guards do no other async work between the call and the await).
 *
 * ── Source-of-truth reality (documented-path drift, #448) ─────────────────────
 * ADR-0006 §6.1 sketches each glossary term as a YAML-frontmatter file
 * (`id:`/`label_ru:`/`bounded_context:` …). The repo NEVER adopted that shape:
 * the live `apps/docs/content/product/glossary/*.md` files carry Keystatic
 * `title:`/`description:`/`lang:` frontmatter and state the canonical id in the
 * BODY as ``**Canonical id:** `snake_id` ``. So the shared reader keys on the body
 * marker (the authoritative, machine-checkable id) — NOT the §6.1 frontmatter,
 * which does not exist. The §6.1 mismatch is tracked decision-debt (#459, the
 * ADR-0006 §6 reconcile), not papered over here: the guards check the reality
 * the repo actually stores.
 *
 * The generated artifact (`packages/glossary/(src/)?ids.ts` → `GLOSSARY_IDS`) and
 * the whole ADR-0006 §6.2 generator pipeline do NOT exist yet (tracked by #460) —
 * that is why the roundtrip guard is honestly empty until the generated side lands.
 */
import {
  readGlossarySourceSync,
  GLOSSARY_SRC_GLOB,
} from "./glossary-source.mjs";

/** The glossary source dir, repo-root-relative POSIX (from the shared primitive). */
export { GLOSSARY_SRC_GLOB };

export interface GlossaryTermSource {
  /** snake_case canonical id (from the body marker). */
  id: string;
  /** repo-root-relative POSIX path of the source file. */
  file: string;
}

/**
 * Read the canonical id of every glossary source term. A file with no
 * ``**Canonical id:** `…` `` marker is skipped (reported via `skipped`) — the id
 * cannot be established, so it contributes nothing to the id set. `meta.json`
 * and any non-term file are ignored by the marker requirement.
 *
 * Async by contract (its guard callers `await` it); the shared read is sync.
 *
 * @param repoRoot absolute repo root (or `LINT_FIXTURE_ROOT` in tests).
 */
export async function readGlossarySource(
  repoRoot: string,
): Promise<{ terms: GlossaryTermSource[]; skipped: string[] }> {
  return readGlossarySourceSync(repoRoot) as {
    terms: GlossaryTermSource[];
    skipped: string[];
  };
}

/** Convenience: just the set of canonical ids. */
export async function readGlossaryIds(repoRoot: string): Promise<Set<string>> {
  const { terms } = await readGlossarySource(repoRoot);
  return new Set(terms.map((t) => t.id));
}
