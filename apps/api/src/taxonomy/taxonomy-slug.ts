import {
  slugifyTaxonomyTitle,
  SlugSchema,
  TAXONOMY_SLUG_ATTEMPT_LIMIT,
  taxonomySlugCandidate,
} from "@ds/schemas";
import { TaxonomyError } from "./taxonomy.errors.js";

export type TaxonomySlugKind = "direction" | "project" | "partner" | "expert";

/** Derive a valid base while keeping even non-transliterable input authorable. */
export function taxonomySlugBase(
  authoredIdentity: string,
  kind: TaxonomySlugKind,
): string {
  const generated = slugifyTaxonomyTitle(authoredIdentity);
  return SlugSchema.parse(generated || kind);
}

/** Allocate the first retained-row-safe candidate in `base`, `base-2`, ... order. */
export async function allocateTaxonomySlug(
  base: string,
  kind: TaxonomySlugKind,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; attempt <= TAXONOMY_SLUG_ATTEMPT_LIMIT; attempt += 1) {
    const candidate = taxonomySlugCandidate(base, attempt);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new TaxonomyError(
    "SLUG_CONFLICT",
    `the system could not allocate a ${kind} page address from the retained collision sequence`,
  );
}
