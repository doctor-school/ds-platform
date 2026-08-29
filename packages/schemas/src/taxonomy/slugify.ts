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
 * (e.g. only emoji): the server-owned allocator then uses its kind fallback.
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
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** The slug length the taxonomy tables and `SlugSchema` agree on. */
const SLUG_MAX = 160;

/**
 * How many derived candidates a caller may try before giving up. Two directions
 * whose titles fold to the same slug is ordinary («Кардиология» in two books);
 * fifty is not, and looping forever on a pathological seed would turn a create
 * into a timeout.
 */
export const TAXONOMY_SLUG_ATTEMPT_LIMIT = 50;

/**
 * The `attempt`-th candidate for one derived base slug: attempt 1 is the base
 * itself, attempt 2 is `base-2`, and so on — so the first direction to claim a
 * title gets the clean address and a later collision is visibly a second one.
 *
 * The suffix is deterministic, never random: re-running a create with the same
 * titles in the same order yields the same addresses, which is what makes an
 * e2e assertion on a derived slug meaningful. Truncation happens on the BASE so
 * the suffix always survives — a candidate silently trimmed back to its
 * neighbour's slug would collide forever.
 */
export function taxonomySlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
