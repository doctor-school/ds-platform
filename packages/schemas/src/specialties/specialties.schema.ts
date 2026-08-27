import { z } from "zod";

// 017 — Минздрав specialty reference-book contracts (API SSOT, ADR-0002 §3,
// ADR-0016 §5; 017-requirements EARS-3, 017-design §2 + §7). Framework-agnostic:
// `apps/api` validates at the I/O boundary with these schemas and the storefront
// (`apps/doctor`) reuses the SAME rule, so a client can never offer, and no
// endpoint can ever accept, a specialty outside the closed book.
//
// The book is CLOSED: `SpecialtyBook.total` is the actual number of entries the
// read serves. Every count surface binds to it — no count literal exists in
// code, in a test assertion or in copy (017-design §7; EARS-3/EARS-4).

/**
 * Stable machine identifier of a book entry. Derived from the specialty name in
 * the seed (transliterated kebab slug), NOT from the ordinal of the nomenclature
 * order — so a re-seed against an amended order keeps the identity of a
 * specialty whose position moved.
 */
export const SPECIALTY_CODE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SPECIALTY_CODE_MAX_LENGTH = 128;
export const SPECIALTY_NAME_MAX_LENGTH = 256;

/**
 * The reserved code of the single non-nomenclature row: «Другое». It is a real
 * member of the book (a doctor may hold it as a primary specialty) and is served
 * by the same read as every nomenclature row.
 */
export const SPECIALTY_OTHER_CODE = "drugoe";

export const SpecialtyCodeSchema = z
  .string()
  .min(1)
  .max(SPECIALTY_CODE_MAX_LENGTH)
  .regex(SPECIALTY_CODE_REGEX);

/**
 * `SpecialtyRef` — the one shape every surface uses to name a specialty.
 * Specialties, directions and schools stay three distinct read models: this ref
 * is never merged into a shared list and never re-labelled with a common word
 * (EARS-3, 017-design §7).
 */
const SPECIALTY_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const SpecialtyRefSchema = z.strictObject({
  id: z.string().regex(SPECIALTY_ID_REGEX),
  code: SpecialtyCodeSchema,
  name: z.string().min(1).max(SPECIALTY_NAME_MAX_LENGTH),
  isOther: z.boolean(),
});
export type SpecialtyRef = z.infer<typeof SpecialtyRefSchema>;

/**
 * `SpecialtyBook` — the full closed book plus «Другое», public read.
 * `total` is served by the read and equals `entries.length`; every surface that
 * shows a specialty count binds to it (017-design §7).
 */
export const SpecialtyBookSchema = z.strictObject({
  entries: z.array(SpecialtyRefSchema),
  total: z.number().int().nonnegative(),
});
export type SpecialtyBook = z.infer<typeof SpecialtyBookSchema>;

/**
 * `FrequentSpecialties` — the frequent set the search-first catalog (Stage-A
 * variant Б) renders beneath the search field. A strict subset of the book; it
 * is a presentation ordering, never a second book.
 */
export const FrequentSpecialtiesSchema = z.strictObject({
  entries: z.array(SpecialtyRefSchema),
});
export type FrequentSpecialties = z.infer<typeof FrequentSpecialtiesSchema>;

/**
 * The longest query the search read will consider. A reference book of a
 * hundred-odd short names has no legitimate query longer than one of its
 * entries; anything past this is refused at the boundary rather than scanned.
 */
export const SPECIALTY_SEARCH_QUERY_MAX_LENGTH = 256;

export const SpecialtySearchQuerySchema = z
  .string()
  .max(SPECIALTY_SEARCH_QUERY_MAX_LENGTH);

/**
 * The ONE normalization behind the catalog search (EARS-5): case-folded,
 * «ё» folded onto «е», trimmed, internal whitespace runs collapsed.
 *
 * It lives here, in the shared contract package, rather than in the API or in
 * the storefront, because both sides must narrow by the SAME rule: a client
 * that highlighted matches by a different rule than the server filtered by
 * would show a doctor a hit that is not there, or hide one that is.
 *
 * `toLowerCase()` alone is not the fold — it maps «Ё» to «ё», not to «е», so
 * the replacement runs after it and covers both cases in one pass.
 */
export function normalizeSpecialtyQuery(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The matching rule itself: does `name` contain `query` as a SUBSTRING under
 * that normalization? Substring anywhere in the name, never a prefix match and
 * never a fuzzy/edit-distance widening — a doctor typing «кардиолог» must find
 * «Детская кардиология», and must never be offered a specialty that merely
 * looks like the one they typed (EARS-5, and the no-computed-likeness rule of
 * EARS-8 applied to the catalog).
 *
 * An empty (or whitespace-only) query narrows nothing: the catalog's Open state
 * is the whole book, not an empty one.
 */
export function specialtyNameMatchesQuery(
  name: string,
  query: string,
): boolean {
  const normalizedQuery = normalizeSpecialtyQuery(query);
  if (normalizedQuery.length === 0) return true;
  return normalizeSpecialtyQuery(name).includes(normalizedQuery);
}

/**
 * `SpecialtySearchResult` — the public search read (017-design §7).
 *
 * `query` echoes back the query the read was given so a storefront can discard
 * a response that a later keystroke has already superseded, and so a no-match
 * state can keep the typed text editable without re-deriving it.
 *
 * `total` is the number of entries THIS read served — the size of the match
 * set, NOT the size of the book. The book size has exactly one source, the
 * `SpecialtyBook.total` of the full read, and it is what «Показать весь список
 * — N» binds to; a count taken from a search result would shrink as a doctor
 * typed.
 */
export const SpecialtySearchResultSchema = z.strictObject({
  query: z.string(),
  entries: z.array(SpecialtyRefSchema),
  total: z.number().int().nonnegative(),
});
export type SpecialtySearchResult = z.infer<typeof SpecialtySearchResultSchema>;

/**
 * Stable error codes for the closed-book contract (RFC 7807 `errorCode`,
 * ADR-0002). Grouped by HTTP status.
 */
export const SPECIALTY_ERROR_CODES = [
  // 422 — the reference is well-formed but names no member of the closed book.
  "SPECIALTY_NOT_IN_BOOK",
] as const;
export const SpecialtyErrorCodeSchema = z.enum(SPECIALTY_ERROR_CODES);
export type SpecialtyErrorCode = z.infer<typeof SpecialtyErrorCodeSchema>;

/**
 * The wire body of a storefront specialty failure: RFC 7807 plus the two
 * platform fields `errorCode` and `traceId` (ADR-0002; 017-design §7). Field for
 * field the same envelope 012 serves — deliberately so, a client parses ONE
 * problem shape — but its `errorCode` is narrowed to the specialty codes rather
 * than reusing the taxonomy enum: a storefront reference-book refusal is not a
 * content-taxonomy error, and admitting it into that enum would let a taxonomy
 * throw site name it (and vice versa) with the compiler's blessing.
 *
 * No database key, table name or internal lifecycle state ever appears here.
 */
export const SpecialtyProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errorCode: SpecialtyErrorCodeSchema,
  traceId: z.string(),
});
export type SpecialtyProblemDetails = z.infer<
  typeof SpecialtyProblemDetailsSchema
>;

/**
 * The membership rule itself, as a reusable predicate over a resolved book.
 * This is the mechanism every specialty-accepting path consumes (the choose-
 * specialty handler of EARS-6 among them): a reference is acceptable ONLY when
 * it names a row of the book that was actually read from `specialties_minzdrav`.
 * Fail-closed — an unresolved or empty book accepts nothing.
 */
export function isSpecialtyBookMember(
  reference: string,
  book: readonly Pick<SpecialtyRef, "id" | "code">[],
): boolean {
  if (typeof reference !== "string" || reference.length === 0) return false;
  return book.some(
    (entry) => entry.id === reference || entry.code === reference,
  );
}
