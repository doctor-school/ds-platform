// 012-design §2.2 — the ONE canonical slugification function. The service
// generates a missing slug with it and the Refine admin's live preview imports
// the same function, so what the operator sees before saving is byte-identical
// to what the server stores. A second implementation in the form would be a
// silent divergence the operator only discovers after publication locks the slug
// forever.
//
// Content is Russian, so transliteration is not optional decoration: «Школа
// кардиологии» must become `shkola-kardiologii`, not an empty string. The table
// is the practical BGN/PCGN-style mapping already familiar from RU URL slugs.

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  // Ukrainian/Belarusian letters an operator may paste from a source title.
  і: "i",
  ї: "i",
  є: "ye",
  ґ: "g",
  ў: "u",
};

/**
 * Fold one authored title into a canonical slug candidate matching
 * `SLUG_REGEX` — NFKC-normalize, transliterate Cyrillic, strip combining marks,
 * lowercase, replace every other run of characters with a single hyphen and trim
 * hyphens. Returns `""` when the title carries no sluggable character at all
 * (e.g. only emoji): the caller then refuses rather than inventing an identity,
 * because a slug is a permanent public URL, not a cosmetic default.
 */
export function slugifyTaxonomyTitle(title: string): string {
  const folded = title
    .normalize("NFKC")
    .toLowerCase()
    .split("")
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("")
    // Decompose so accented Latin (é, ü) loses its combining mark instead of
    // being dropped as a non-ASCII run.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
    .replace(/-+$/g, "");
}
