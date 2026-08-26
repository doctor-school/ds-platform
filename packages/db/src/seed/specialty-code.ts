// 017 — the deterministic name → `code` derivation for the closed Минздрав
// specialty book (017-design §2). The code is the STABLE identity of a book
// entry: it is derived from the specialty's own wording, never from its ordinal
// in the nomenclature order, so an amended order that renumbers or re-sorts
// Раздел I re-seeds onto the same rows and every stored reference to a doctor's
// specialty survives untouched.

/**
 * GOST-flavoured Cyrillic → ASCII table. Fixed on purpose: the produced code is
 * persisted identity, so this map is append-only — changing an existing mapping
 * would silently re-identify rows on the next re-seed.
 *
 * «ё» folds to «е» so that the code matches the ё/е-insensitive search rule of
 * EARS-5 rather than fighting it.
 */
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
  й: "i",
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
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/**
 * A TEMPORAL qualifier the order prints inside the entry itself — «Бактериология
 * (сохраняется до 1 сентября 2028 г.)», «Паллиативная медицинская помощь
 * (с 1 сентября 2027 г.)». It states when the entry enters or leaves force; it
 * is not part of the specialty's identity, and the next order will print a
 * different date or none at all.
 *
 * Deliberately narrow — anchored at the end and requiring «сохраняется до» or
 * «с » followed by a digit — so an identity-bearing parenthetical such as «Общая
 * врачебная практика (семейная медицина)» is left alone.
 */
const TEMPORAL_QUALIFIER = /\s*\((?:сохраняется\s+до|с)\s+\d[^)]*\)\s*$/u;

/**
 * The identity-bearing wording of an entry: its printed name with any temporal
 * qualifier removed. `name` stays verbatim in the row — the doctor sees exactly
 * what the order says — while the CODE is derived from this, so an amended order
 * that moves or drops a date re-seeds onto the SAME row instead of orphaning
 * every doctor who holds that specialty.
 */
export function specialtyIdentityName(name: string): string {
  return name.replace(TEMPORAL_QUALIFIER, "").trim();
}

/**
 * Derives the book code of a specialty from its nomenclature name.
 * Lowercase ASCII words joined by single hyphens — the grammar the
 * `specialties_minzdrav_code_format` CHECK and `SPECIALTY_CODE_REGEX` enforce.
 */
export function specialtyCodeFromName(name: string): string {
  const code = Array.from(specialtyIdentityName(name).toLowerCase())
    .map((char) => {
      const latin = CYRILLIC_TO_LATIN[char];
      if (latin !== undefined) return latin;
      return /[a-z0-9]/.test(char) ? char : "-";
    })
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (code.length === 0) {
    throw new Error(
      `specialty name produced an empty code: ${JSON.stringify(name)}`,
    );
  }
  return code;
}
