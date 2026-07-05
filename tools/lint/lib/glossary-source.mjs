/**
 * tools/lint/lib/glossary-source.mjs — the ONE low-level reader of the glossary
 * canonical-id source. Both glossary readers delegate here, so the source glob
 * and the ``**Canonical id:**`` body-marker parse live in exactly one place
 * (#500 — reconcile of the former sync/async twins).
 *
 * ── Plain-ESM + SYNCHRONOUS by the most-constrained consumer ──────────────────
 * The `glossary-canonical-ids` ESLint rule (#468) rides the plain-node `eslint .`
 * path — NO tsx, NO build — so it cannot import a `.ts`, and an ESLint rule's
 * `create()` is synchronous (cannot `await`). A `.ts` module CAN import a `.mjs`,
 * though, so the async tsx-run guard reader (`lib/glossary.ts`) delegates here too
 * and simply wraps this sync result in its existing Promise-returning signature.
 *
 * ── Source-of-truth reality (why the BODY marker, not §6.1 frontmatter) ───────
 * ADR-0006 §6.1 sketches each glossary term as a YAML-frontmatter file
 * (`id:`/`label_ru:` …). The repo NEVER adopted that shape: the live
 * `apps/docs/content/product/glossary/*.md` files carry Keystatic
 * `title:`/`description:`/`lang:` frontmatter and state the canonical id in the
 * BODY as ``**Canonical id:** `snake_id` ``. So this reader keys on the body
 * marker (the authoritative, machine-checkable id) — NOT the §6.1 frontmatter,
 * which the repo never adopted. The ADR-0006 §6.1 format was reconciled to this
 * body-marker reality in #459 — the body marker is the format of record. Full
 * context in `lib/glossary.ts`'s header.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";

/** The glossary source dir, repo-root-relative POSIX. */
export const GLOSSARY_SRC_GLOB = "apps/docs/content/product/glossary/*.md";

/** ``**Canonical id:** `snake_id` `` — the authoritative id marker in the body. */
const CANONICAL_ID_RE = /\*\*Canonical id:\*\*\s*`([a-z][a-z0-9_]*)`/;

/**
 * @typedef {{ id: string, file: string }} GlossaryTermSource
 *   `id` = snake_case canonical id (from the body marker); `file` =
 *   repo-root-relative POSIX path of the source file.
 */

/**
 * Read every glossary source term SYNCHRONOUSLY. A file with no
 * ``**Canonical id:** `…` `` marker is skipped (reported via `skipped`) — its id
 * cannot be established, so it contributes nothing to the term set. `meta.json`
 * and any non-term file are ignored by the marker requirement.
 *
 * No floor assertion at this layer: an empty result is a valid (if suspicious)
 * state for the primitive. The id-set reader that DEPENDS on non-emptiness
 * (`glossary-ids.mjs`, for the ESLint rule) asserts the floor itself.
 *
 * @param {string} repoRoot absolute repo root (or a fixture root in tests).
 * @returns {{ terms: GlossaryTermSource[], skipped: string[] }}
 */
export function readGlossarySourceSync(repoRoot) {
  const files = fg.sync(GLOSSARY_SRC_GLOB, {
    cwd: repoRoot,
    ignore: ["**/node_modules/**"],
  });
  const terms = [];
  const skipped = [];
  for (const rel of files.sort()) {
    const posix = rel.replace(/\\/g, "/");
    const raw = readFileSync(resolve(repoRoot, rel), "utf8");
    const m = raw.match(CANONICAL_ID_RE);
    if (!m) {
      skipped.push(posix);
      continue;
    }
    terms.push({ id: m[1], file: posix });
  }
  return { terms, skipped };
}
