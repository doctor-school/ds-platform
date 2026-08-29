import { CANONICAL_UUID_REGEX, SlugSchema } from "@ds/schemas";
import { describe, expect, it } from "vitest";

import {
  taxonomySlugBase,
  type TaxonomySlugKind,
} from "../../src/taxonomy/taxonomy-slug.js";

describe("taxonomy system-owned slug allocation", () => {
  it("EARS-20: UUID-shaped authored identities shall receive valid kind-prefixed non-UUID bases", () => {
    const authoredUuid = "123e4567-e89b-12d3-a456-426614174000";
    const kinds: TaxonomySlugKind[] = [
      "direction",
      "project",
      "partner",
      "expert",
    ];

    for (const kind of kinds) {
      const base = taxonomySlugBase(authoredUuid, kind);
      expect(base).toMatch(new RegExp(`^${kind}-`));
      expect(base).not.toMatch(CANONICAL_UUID_REGEX);
      expect(SlugSchema.safeParse(base).success).toBe(true);
    }
  });
});
