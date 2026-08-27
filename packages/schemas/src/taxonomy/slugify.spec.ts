import { describe, expect, it } from "vitest";

import {
  slugifyTaxonomyTitle,
  taxonomySlugCandidate,
  TAXONOMY_SLUG_ATTEMPT_LIMIT,
} from "./index.js";

// 017 EARS-18 (#1483) — the direction address is DERIVED, so this folding is no
// longer a convenience the operator may override: it is the only implementation
// of a permanent public URL. The cases below are the ones a Russian editorial
// title actually produces, not synthetic ASCII.
describe("017 taxonomy — derived slug folding (SSOT)", () => {
  it("EARS-18.8: the folding shall transliterate a Russian title into a usable address", () => {
    expect(slugifyTaxonomyTitle("Кардиология")).toBe("kardiologiya");
    expect(slugifyTaxonomyTitle("Детская кардиология")).toBe(
      "detskaya-kardiologiya",
    );
    // The letters an editorial title trips over: ё folds to `e`, й to `y`, щ to
    // `shch`, and the soft/hard signs disappear rather than becoming hyphens —
    // «Пульмонология» must not come out as `pul-monologiya`.
    expect(slugifyTaxonomyTitle("Ёлочная терапия")).toBe("elochnaya-terapiya");
    expect(slugifyTaxonomyTitle("Йога и здоровье")).toBe("yoga-i-zdorove");
    expect(slugifyTaxonomyTitle("Защита щитовидной железы")).toBe(
      "zashchita-shchitovidnoy-zhelezy",
    );
    expect(slugifyTaxonomyTitle("Пульмонология")).toBe("pulmonologiya");
    expect(slugifyTaxonomyTitle("Объективная неврология")).toBe(
      "obektivnaya-nevrologiya",
    );
  });

  it("EARS-18.9: the folding shall collapse punctuation and trim, and shall yield an empty string when the title carries no sluggable character", () => {
    expect(slugifyTaxonomyTitle("  Кардиология — 2026!  ")).toBe(
      "kardiologiya-2026",
    );
    expect(slugifyTaxonomyTitle("Кардиология / Аритмология")).toBe(
      "kardiologiya-aritmologiya",
    );
    // Emoji only: the caller refuses against `title` rather than inventing an
    // identity for a URL that can never be changed afterwards.
    expect(slugifyTaxonomyTitle("🫀🫁")).toBe("");
    expect(slugifyTaxonomyTitle("«»—")).toBe("");
  });

  it("EARS-18.10: the candidate sequence shall start at the clean address and suffix deterministically from there", () => {
    expect(taxonomySlugCandidate("kardiologiya", 1)).toBe("kardiologiya");
    expect(taxonomySlugCandidate("kardiologiya", 2)).toBe("kardiologiya-2");
    expect(taxonomySlugCandidate("kardiologiya", 3)).toBe("kardiologiya-3");
    // Re-running the same titles in the same order yields the same addresses —
    // that determinism is what makes an e2e assertion on a derived slug mean
    // anything at all.
    expect(taxonomySlugCandidate("kardiologiya", 2)).toBe(
      taxonomySlugCandidate("kardiologiya", 2),
    );
  });

  it("EARS-18.11: truncation shall fall on the BASE so the collision suffix always survives the 160-char bound", () => {
    const long = "a".repeat(160);
    expect(slugifyTaxonomyTitle(long)).toHaveLength(160);

    const suffixed = taxonomySlugCandidate(long, 12);
    expect(suffixed).toHaveLength(160);
    expect(suffixed.endsWith("-12")).toBe(true);
    // A candidate silently trimmed back to its neighbour's slug would collide
    // forever, so the suffixed candidate is never equal to the base.
    expect(suffixed).not.toBe(long);
    expect(TAXONOMY_SLUG_ATTEMPT_LIMIT).toBe(50);
  });
});
