/**
 * tools/lint/lib/glossary-ids.mjs — the id-SET projection of the shared glossary
 * source reader, consumed by the `glossary-canonical-ids` ESLint rule (#468).
 *
 * Both glossary readers now delegate to ONE primitive (`glossary-source.mjs`,
 * #500): the glob + ``**Canonical id:**`` parse live there, once. This file adds
 * only (a) the projection to the id `Set` and (b) the FLOOR ASSERTION the ESLint
 * rule depends on. See `glossary-source.mjs` for why the primitive is plain-ESM
 * and synchronous (the plain-node `eslint .` path can do neither tsx nor async).
 */
import {
  readGlossarySourceSync,
  GLOSSARY_SRC_GLOB,
} from "./glossary-source.mjs";

/** Re-export so the ESLint rule / tests can reference the source glob. */
export { GLOSSARY_SRC_GLOB };

/**
 * Read the set of glossary canonical ids from the source `.md` files under
 * `repoRoot`. A file with no `**Canonical id:**` marker contributes nothing (its
 * id cannot be established) — same rule as the async reader.
 *
 * Floor assertion: the glossary source files are committed, so a genuinely empty
 * id set means the source moved / emptied / lost all markers — which would make
 * the `glossary-canonical-ids` rule silently no-op (a guard whose value vanishes
 * with no signal). That is a real breakage, so THROW rather than return `∅`.
 *
 * @param {string} repoRoot absolute repo root (or a fixture root in tests).
 * @returns {Set<string>} the non-empty canonical id set.
 * @throws {Error} if zero canonical ids are parsed.
 */
export function readGlossaryIdsSync(repoRoot) {
  const { terms, skipped } = readGlossarySourceSync(repoRoot);
  const ids = new Set(terms.map((t) => t.id));
  if (ids.size === 0) {
    throw new Error(
      `[glossary-ids] no glossary canonical ids parsed from ` +
        `${GLOSSARY_SRC_GLOB} under ${repoRoot} (scanned ${skipped.length} file(s)). ` +
        `The committed glossary source is missing or lost its \`**Canonical id:**\` ` +
        `markers — the glossary-canonical-ids rule would silently enforce nothing. ` +
        `Restore the glossary source or fix the marker format.`,
    );
  }
  return ids;
}
