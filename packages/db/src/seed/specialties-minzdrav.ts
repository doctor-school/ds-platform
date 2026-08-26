import { sql } from "drizzle-orm";

import { specialtiesMinzdrav } from "../schema/specialties.js";
import {
  FREQUENT_SPECIALTY_NAMES,
  MINZDRAV_ORDER,
  RAZDEL_I_NAMES,
  SPECIALTY_OTHER_NAME,
} from "./specialties-minzdrav.data.js";
import { specialtyCodeFromName } from "./specialty-code.js";

// 017 — the seed of the closed Минздрав specialty reference book (EARS-3,
// 017-design §2). The book is populated ONLY here: no 017 path and no storefront
// surface writes `specialties_minzdrav`.
//
// The size of the book lives in the data file and nowhere else. This module
// derives it (`buildSpecialtyBookSeed().length`); code, tests and copy read the
// derived value or `SpecialtyBook.total`, never a literal.

export interface SpecialtyBookSeedRow {
  code: string;
  name: string;
  isOther: boolean;
  /** 1-based position in the frequent set; null for a non-frequent entry. */
  frequentRank: number | null;
}

/**
 * Builds the full book: every Раздел-I entry of the nomenclature order in force,
 * in the order's own sequence, followed by «Другое».
 *
 * «Другое» is placed LAST and is never given a frequent rank: it is the
 * catch-all a doctor falls back to, not one of the specialties the catalog
 * offers up front.
 *
 * Throws rather than silently producing a degraded book — a duplicate code, a
 * duplicate name or a frequent name that is not a member of the nomenclature is
 * a seed defect, and a reference book that quietly drops or merges an entry is
 * worse than one that refuses to load.
 */
export function buildSpecialtyBookSeed(): SpecialtyBookSeedRow[] {
  const frequentRankByName = new Map<string, number>(
    FREQUENT_SPECIALTY_NAMES.map((name, index) => [name, index + 1]),
  );

  const nomenclature = RAZDEL_I_NAMES.map((name) => ({
    code: specialtyCodeFromName(name),
    name,
    isOther: false,
    frequentRank: frequentRankByName.get(name) ?? null,
  }));

  const missingFrequent = FREQUENT_SPECIALTY_NAMES.filter(
    (name) => !RAZDEL_I_NAMES.includes(name),
  );
  if (missingFrequent.length > 0) {
    throw new Error(
      `frequent specialties are not members of ${MINZDRAV_ORDER.number} Раздел I: ${missingFrequent.join(", ")}`,
    );
  }

  const rows: SpecialtyBookSeedRow[] = [
    ...nomenclature,
    {
      code: specialtyCodeFromName(SPECIALTY_OTHER_NAME),
      name: SPECIALTY_OTHER_NAME,
      isOther: true,
      frequentRank: null,
    },
  ];

  assertUnique(
    rows.map((row) => row.code),
    "code",
  );
  assertUnique(
    rows.map((row) => row.name),
    "name",
  );

  return rows;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `duplicate specialty ${label} in the seed: ${[...duplicates].join(", ")}`,
    );
  }
}

/**
 * Minimal structural contract of the drizzle handle this seed needs, so the
 * function stays usable from the API bootstrap, a migration runner and a test
 * harness without importing a concrete client.
 */
type SpecialtySeedExecutor = {
  insert: (table: typeof specialtiesMinzdrav) => {
    values: (rows: SpecialtyBookSeedRow[]) => {
      onConflictDoUpdate: (config: {
        target: typeof specialtiesMinzdrav.code;
        set: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
};

/**
 * Idempotent upsert of the whole book, keyed on `code`.
 *
 * Re-running it against an already-seeded database updates wording and frequent
 * ranks in place and keeps every `id` — the property that lets a doctor's stored
 * primary specialty survive a re-seed after an amended order. It never deletes:
 * withdrawing an entry that doctors may already hold is a migration decision,
 * not a seed side effect.
 */
export async function seedSpecialtiesMinzdrav(
  db: SpecialtySeedExecutor,
  rows: SpecialtyBookSeedRow[] = buildSpecialtyBookSeed(),
): Promise<number> {
  await db
    .insert(specialtiesMinzdrav)
    .values(rows)
    .onConflictDoUpdate({
      target: specialtiesMinzdrav.code,
      set: {
        name: sql`excluded.name`,
        isOther: sql`excluded.is_other`,
        frequentRank: sql`excluded.frequent_rank`,
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}
