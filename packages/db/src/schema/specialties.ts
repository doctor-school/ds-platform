import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// 017 — the closed Минздрав specialty reference book (017-design §2, §7;
// ADR-0016 §5; EARS-3). The table is a REFERENCE BOOK, not an editorial entity:
// it is populated by the provenance-stamped seed in `packages/db/src/seed/` and
// no 017 path — and no storefront surface — writes it. There is therefore no
// draft/published lifecycle, no `deleted_at` and no optimistic-concurrency
// `version` column here: a row's only lifecycle event is a re-seed against a new
// nomenclature order.
//
// The row COUNT is a property of the seed and never a constant in code, spec or
// copy (017-design §2). Every count surface reads `SpecialtyBook.total`.

/**
 * The machine-identifier grammar of a book entry: lowercase ASCII words joined
 * by single hyphens, transliterated from the specialty name by the seed.
 * Mirrored by `SPECIALTY_CODE_REGEX` in `@ds/schemas` — the DB owns the column
 * constraint, the Zod schema owns the wire contract.
 */
export const SPECIALTY_CODE_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

export const SPECIALTY_CODE_MAX = 128;
export const SPECIALTY_NAME_MAX = 256;

/**
 * The reserved code of the single non-nomenclature row, «Другое». It is a full
 * member of the book: it is served by the same public read, may be held as a
 * primary specialty, and routes the storefront blocks to their general
 * (non-targeted) selections rather than to an empty targeted result (EARS-8).
 */
export const SPECIALTY_OTHER_CODE = "drugoe";

/**
 * `specialties_minzdrav` — one row per entry of the Минздрав nomenclature order
 * in force, plus the one `is_other` row.
 *
 * `code` (not the ordinal of the order) is the stable identity: an amended order
 * that renumbers or re-sorts its Раздел I must not re-identify a specialty a
 * doctor already holds. The seed upserts on `code`, so `id` survives a re-seed
 * and every stored `DOCTOR_SPECIALTY` / `SPECIALTY_DIRECTION` reference stays
 * valid.
 *
 * `frequent_rank` carries the frequent set of 017-design §7's
 * `FrequentSpecialties` read: a nullable 1-based position, non-null exactly for
 * the entries the search-first catalog (Stage-A variant Б) renders beneath the
 * search field. Storing the rank rather than a boolean keeps the CANVAS ORDER —
 * the frequent set is an ordered presentation of book rows, never a second book,
 * so it lives on the book row instead of in a parallel table that could drift
 * out of membership.
 */
export const specialtiesMinzdrav = pgTable(
  "specialties_minzdrav",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stable transliterated identity; the seed's upsert conflict target. */
    code: text("code").notNull(),
    /** Verbatim nomenclature wording — never normalized, glossed or abbreviated. */
    name: text("name").notNull(),
    /** True for the single «Другое» row; false for every nomenclature entry. */
    isOther: boolean("is_other").notNull().default(false),
    /** 1-based position in the frequent set; null for a non-frequent entry. */
    frequentRank: integer("frequent_rank"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The identity the seed upserts on and every reference resolves through.
    uniqueIndex("specialties_minzdrav_code_key").on(t.code),
    // A nomenclature name appears once. A duplicate row would inflate `total`
    // and put the same specialty twice into the catalog.
    uniqueIndex("specialties_minzdrav_name_key").on(t.name),
    // Exactly one «Другое»: the book has a single catch-all, so `is_other` can
    // never become a second, parallel classification.
    uniqueIndex("specialties_minzdrav_is_other_key")
      .on(t.isOther)
      .where(sql`${t.isOther}`),
    // The frequent set is an ORDER: no two entries share a position.
    uniqueIndex("specialties_minzdrav_frequent_rank_key")
      .on(t.frequentRank)
      .where(sql`${t.frequentRank} IS NOT NULL`),
    check(
      "specialties_minzdrav_code_format",
      sql`${t.code} ~ ${sql.raw(`'${SPECIALTY_CODE_PATTERN}'`)} AND length(${t.code}) <= ${sql.raw(String(SPECIALTY_CODE_MAX))}`,
    ),
    check(
      "specialties_minzdrav_name_nonempty",
      sql`length(btrim(${t.name})) > 0 AND length(${t.name}) <= ${sql.raw(String(SPECIALTY_NAME_MAX))}`,
    ),
    check(
      "specialties_minzdrav_frequent_rank_positive",
      sql`${t.frequentRank} IS NULL OR ${t.frequentRank} >= 1`,
    ),
  ],
);

export type SpecialtyMinzdrav = typeof specialtiesMinzdrav.$inferSelect;
export type NewSpecialtyMinzdrav = typeof specialtiesMinzdrav.$inferInsert;
