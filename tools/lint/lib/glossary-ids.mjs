/**
 * tools/lint/lib/glossary-ids.mjs — SYNCHRONOUS, plain-ESM reader for the
 * glossary canonical-id set, for the `glossary-canonical-ids` ESLint rule (#468).
 *
 * ── Why a plain-ESM sync twin of lib/glossary.ts ──────────────────────────────
 * The two ADR-0006 §6 glossary GUARDS (glossary-mdx-lint, glossary-roundtrip-lint)
 * are `tsx`-run scripts and consume the async `readGlossaryIds` in `lib/glossary.ts`.
 * The `glossary-canonical-ids` ESLint rule is different on two axes: it rides the
 * plain-node `eslint .` path (NO tsx, NO build — so it cannot import a `.ts` module
 * nor the built `@ds/glossary/ids` dist), and an ESLint rule's `create()` is
 * synchronous (so it cannot `await`). Hence this file mirrors `readGlossaryIds`'s
 * APPROACH exactly — same source (`apps/docs/content/product/glossary/*.md`), same
 * `**Canonical id:**` body marker — but synchronously in plain ESM. The
 * two-line glob+regex duplication with `lib/glossary.ts` is tracked decision-debt
 * to reconcile into one shared module when the ADR-0006 §6.2 generator (#460) lands.
 *
 * Keying on the BODY marker (not §6.1 frontmatter, which the repo never adopted)
 * matches `lib/glossary.ts` — see its header for the source-of-truth reality.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";

/** The glossary source dir, repo-root-relative POSIX (matches lib/glossary.ts). */
export const GLOSSARY_SRC_GLOB = "apps/docs/content/product/glossary/*.md";

/** ``**Canonical id:** `snake_id` `` — authoritative id marker (matches lib/glossary.ts). */
const CANONICAL_ID_RE = /\*\*Canonical id:\*\*\s*`([a-z][a-z0-9_]*)`/;

/**
 * Read the set of glossary canonical ids from the source `.md` files under
 * `repoRoot`. A file with no `**Canonical id:**` marker contributes nothing (its
 * id cannot be established) — same rule as the async reader.
 *
 * @param {string} repoRoot absolute repo root (or a fixture root in tests).
 * @returns {Set<string>} the canonical id set.
 */
export function readGlossaryIdsSync(repoRoot) {
  const files = fg.sync(GLOSSARY_SRC_GLOB, {
    cwd: repoRoot,
    ignore: ["**/node_modules/**"],
  });
  const ids = new Set();
  for (const rel of files.sort()) {
    const raw = readFileSync(resolve(repoRoot, rel), "utf8");
    const m = raw.match(CANONICAL_ID_RE);
    if (m) ids.add(m[1]);
  }
  return ids;
}
