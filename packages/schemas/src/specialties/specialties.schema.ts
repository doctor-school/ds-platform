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
