import { describe, expect, it } from "vitest";
import {
  normalizeSpecialtyQuery,
  SPECIALTY_SEARCH_QUERY_MAX_LENGTH,
  SpecialtySearchQuerySchema,
  SpecialtySearchResultSchema,
  specialtyNameMatchesQuery,
} from "./index.js";

// 017 EARS-5 (#1481) — the catalog matching rule, as a contract of the SHARED
// package rather than of either side that consumes it.
//
// It lives here, database-free, because it is the tier that can prove both
// «ё/е» directions without depending on whether the seeded nomenclature order
// happens to contain a «ё» — and because the api and the storefront must narrow
// by the same rule: a client highlighting matches by a different rule than the
// server filtered by would show a doctor a hit that is not there.
//
// The served read of the same rule over the real book is one tier down, in
// `apps/api/test/storefront/specialty-search.spec.ts`.

describe("017 EARS-5 specialty matching rule", () => {
  it("017 EARS-5.1: matches a fragment ANYWHERE in the name, not only at the start", () => {
    expect(specialtyNameMatchesQuery("Детская кардиология", "кардиолог")).toBe(
      true,
    );
    // A fragment starting mid-word still matches — substring, never prefix.
    expect(specialtyNameMatchesQuery("Детская кардиология", "ская кард")).toBe(
      true,
    );
    expect(specialtyNameMatchesQuery("Детская кардиология", "неврол")).toBe(
      false,
    );
    // Never a fuzzy/edit-distance widening: a near-miss is a miss, so the
    // catalog can never offer a specialty that merely LOOKS like the typed one.
    expect(specialtyNameMatchesQuery("Неврология", "неврологея")).toBe(false);
  });

  it("017 EARS-5.2: matches case-insensitively in both directions", () => {
    expect(specialtyNameMatchesQuery("Неврология", "НЕВРОЛОГИЯ")).toBe(true);
    expect(specialtyNameMatchesQuery("НЕВРОЛОГИЯ", "неврология")).toBe(true);
    expect(specialtyNameMatchesQuery("Неврология", "НеВрОлОгИя")).toBe(true);
  });

  it("017 EARS-5.3: treats «ё» and «е» as the same letter in BOTH directions", () => {
    // A name written with «ё», typed with «е».
    expect(specialtyNameMatchesQuery("Аллергология-иммунолёгия", "лог")).toBe(
      true,
    );
    // A name written with «е», typed with «ё».
    expect(specialtyNameMatchesQuery("Терапия", "тёрапия")).toBe(true);
    // Capital «Ё» folds too — `toLowerCase()` alone maps it to «ё», not «е»,
    // so a fold applied before case-folding would leave this unmatched.
    expect(specialtyNameMatchesQuery("Ёлочная болезнь", "елоч")).toBe(true);
    expect(specialtyNameMatchesQuery("Елочная болезнь", "Ёлоч")).toBe(true);
  });

  it("017 EARS-5.4: an empty or whitespace-only query narrows nothing", () => {
    // The catalog's Open state is the whole book, never an empty one.
    expect(specialtyNameMatchesQuery("Терапия", "")).toBe(true);
    expect(specialtyNameMatchesQuery("Терапия", "   ")).toBe(true);
  });

  it("017 EARS-5.5: normalizes by trimming and collapsing whitespace runs", () => {
    expect(normalizeSpecialtyQuery("  Тёрапия  ")).toBe("терапия");
    expect(
      specialtyNameMatchesQuery("Общая врачебная практика", " общая  врачебная "),
    ).toBe(true);
  });

  it("017 EARS-5.6: refuses a query longer than the boundary allows", () => {
    expect(
      SpecialtySearchQuerySchema.safeParse(
        "я".repeat(SPECIALTY_SEARCH_QUERY_MAX_LENGTH),
      ).success,
    ).toBe(true);
    expect(
      SpecialtySearchQuerySchema.safeParse(
        "я".repeat(SPECIALTY_SEARCH_QUERY_MAX_LENGTH + 1),
      ).success,
    ).toBe(false);
    // A non-string `q` (a repeated query parameter arrives as an array) is
    // refused at the boundary rather than coerced into a scan.
    expect(SpecialtySearchQuerySchema.safeParse(["а", "б"]).success).toBe(false);
  });

  it("017 EARS-5.7: the search result is a strict shape carrying its own served total", () => {
    const entry = {
      id: "00000000-0000-4000-8000-000000000001",
      code: "terapiya",
      name: "Терапия",
      isOther: false,
    };
    const parsed = SpecialtySearchResultSchema.parse({
      query: "тер",
      entries: [entry],
      total: 1,
    });
    expect(parsed.total).toBe(parsed.entries.length);
    // Strict: no extra field — a book size smuggled alongside the match count
    // would give the «Показать весь список — N» control a second source.
    expect(() =>
      SpecialtySearchResultSchema.parse({
        query: "тер",
        entries: [entry],
        total: 1,
        bookTotal: 118,
      }),
    ).toThrow();
  });
});
