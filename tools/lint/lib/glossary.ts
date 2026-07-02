/**
 * tools/lint/lib/glossary.ts — shared reader for the glossary SOURCE-of-truth,
 * used by the two ADR-0006 §6 glossary guards (glossary-mdx-lint,
 * glossary-roundtrip-lint).
 *
 * ── Source-of-truth reality (documented-path drift, #448) ─────────────────────
 * ADR-0006 §6.1 sketches each glossary term as a YAML-frontmatter file
 * (`id:`/`label_ru:`/`bounded_context:` …). The repo NEVER adopted that shape:
 * the live `apps/docs/content/product/glossary/*.md` files carry Keystatic
 * `title:`/`description:`/`lang:` frontmatter and state the canonical id in the
 * BODY as ``**Canonical id:** `snake_id` ``. So this reader keys on the body
 * marker (the authoritative, machine-checkable id) — NOT the §6.1 frontmatter,
 * which does not exist. The §6.1 mismatch is decision-debt reported on #448, not
 * papered over here: the guards check the reality the repo actually stores.
 *
 * The generated artifact (`packages/glossary/(src/)?ids.ts` → `GLOSSARY_IDS`) and
 * the whole ADR-0006 §6.2 generator pipeline do NOT exist yet — that is why the
 * roundtrip guard is honestly empty until the generated side lands.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fg from "fast-glob";

/** The glossary source dir, repo-root-relative POSIX. */
export const GLOSSARY_SRC_GLOB = "apps/docs/content/product/glossary/*.md";

/** ``**Canonical id:** `snake_id` `` — the authoritative id marker in the body. */
const CANONICAL_ID_RE = /\*\*Canonical id:\*\*\s*`([a-z][a-z0-9_]*)`/;

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
 * @param repoRoot absolute repo root (or `LINT_FIXTURE_ROOT` in tests).
 */
export async function readGlossarySource(
  repoRoot: string,
): Promise<{ terms: GlossaryTermSource[]; skipped: string[] }> {
  const files = await fg(GLOSSARY_SRC_GLOB, {
    cwd: repoRoot,
    ignore: ["**/node_modules/**"],
  });
  const terms: GlossaryTermSource[] = [];
  const skipped: string[] = [];
  for (const rel of files.sort()) {
    const posix = rel.replace(/\\/g, "/");
    const raw = await readFile(resolve(repoRoot, rel), "utf8");
    const m = raw.match(CANONICAL_ID_RE);
    if (!m) {
      skipped.push(posix);
      continue;
    }
    terms.push({ id: m[1], file: posix });
  }
  return { terms, skipped };
}

/** Convenience: just the set of canonical ids. */
export async function readGlossaryIds(repoRoot: string): Promise<Set<string>> {
  const { terms } = await readGlossarySource(repoRoot);
  return new Set(terms.map((t) => t.id));
}
