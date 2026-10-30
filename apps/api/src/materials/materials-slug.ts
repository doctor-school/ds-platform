import {
  slugifyTaxonomyTitle,
  SlugSchema,
  TAXONOMY_SLUG_ATTEMPT_LIMIT,
  taxonomySlugCandidate,
} from "@ds/schemas";
import { TaxonomyError } from "../taxonomy/index.js";

// 048-design §Data model — a material's slug comes from its title through the
// SAME shared slug primitives of `@ds/schemas` the 012 entities use (Cyrillic
// transliteration, the retained collision sequence). Only the fallback prefix
// and the reserved route words are material-specific: `/materials/feed` and the
// admin route words must never be a material address.

const MATERIAL_SLUG_PREFIX = "material";
const RESERVED_SLUGS: ReadonlySet<string> = new Set(["feed", "new", "preview"]);

/** Derive a valid, non-reserved base from the title. */
export function materialSlugBase(title: string): string {
  const generated = slugifyTaxonomyTitle(title);
  if (!generated) return MATERIAL_SLUG_PREFIX;
  if (
    SlugSchema.safeParse(generated).success &&
    !RESERVED_SLUGS.has(generated)
  ) {
    return generated;
  }
  return SlugSchema.parse(
    slugifyTaxonomyTitle(`${MATERIAL_SLUG_PREFIX}-${generated}`),
  );
}

/** The first free candidate in `base`, `base-2`, … order. */
export async function allocateMaterialSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; attempt <= TAXONOMY_SLUG_ATTEMPT_LIMIT; attempt += 1) {
    const candidate = taxonomySlugCandidate(base, attempt);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new TaxonomyError(
    "SLUG_CONFLICT",
    "the system could not allocate a material page address from the retained collision sequence",
  );
}
