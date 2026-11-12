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

  // 030-design §«Endpoints»: `/v1/public/projects/scale` and
  // `/v1/admin/projects/order` are literal segments beside `/:idOrSlug`, so
  // no project may own either address.
  it("EARS-9: a project titled with a reserved route segment shall receive a kind-prefixed base", () => {
    for (const title of ["Scale", "ORDER", "scale"]) {
      const base = taxonomySlugBase(title, "project");
      expect(base, title).toMatch(/^project-(scale|order)$/);
      expect(SlugSchema.safeParse(base).success).toBe(true);
    }
    expect(taxonomySlugBase("Scale", "direction")).toBe("scale");
    expect(taxonomySlugBase("Scale up", "project")).toBe("scale-up");
  });
});
