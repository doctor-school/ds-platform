import { sql, type SQL } from "drizzle-orm";

import { specialtiesMinzdrav } from "../schema/specialties.js";
import {
  FREQUENT_SPECIALTY_NAMES,
  MINZDRAV_ORDER,
  RAZDEL_I_NAMES,
  SPECIALTY_OTHER_NAME,
} from "./specialties-minzdrav.data.js";
import { specialtyCodeFromName } from "./specialty-code.js";
import { specialtyIdFromCode } from "./specialty-id.js";

// 017 — the seed of the closed Минздрав specialty reference book (EARS-3,
// 017-design §2). The book is populated ONLY here: no 017 path and no storefront
// surface writes `specialties_minzdrav`.
//
// The size of the book lives in the data file and nowhere else. This module
// derives it (`buildSpecialtyBookSeed().length`); code, tests and copy read the
// derived value or `SpecialtyBook.total`, never a literal.

export interface SpecialtyBookSeedRow {
  /**
   * Deterministic primary key derived from {@link SpecialtyBookSeedRow.code}
   * ({@link specialtyIdFromCode}). Used by the INSERT branch only — the
   * `ON CONFLICT (code)` branch never rewrites the `id` of a row that already
   * exists, so ids handed out by an earlier random default survive untouched.
   */
  id: string;
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

  const nomenclature = RAZDEL_I_NAMES.map((name) => {
    const code = specialtyCodeFromName(name);
    return {
      id: specialtyIdFromCode(code),
      code,
      name,
      isOther: false,
      frequentRank: frequentRankByName.get(name) ?? null,
    };
  });

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
      id: specialtyIdFromCode(specialtyCodeFromName(SPECIALTY_OTHER_NAME)),
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
  assertUnique(
    rows.map((row) => row.id),
    "id",
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

/** A book row as it is handed to the INSERT, timestamps included. */
export interface SpecialtyBookInsertRow extends SpecialtyBookSeedRow {
  /** Pinned creation instant; omitted so the column default applies. */
  createdAt?: Date;
  /** Pinned update instant; omitted so the column default applies. */
  updatedAt?: Date;
}

/**
 * Minimal structural contract of the drizzle handle this seed needs, so the
 * function stays usable from the API bootstrap, a migration runner and a test
 * harness without importing a concrete client.
 */
type SpecialtySeedExecutor = {
  insert: (table: typeof specialtiesMinzdrav) => {
    values: (rows: SpecialtyBookInsertRow[]) => {
      onConflictDoUpdate: (config: {
        target: typeof specialtiesMinzdrav.code;
        set: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
  update: (table: typeof specialtiesMinzdrav) => {
    set: (values: { frequentRank: null }) => {
      where: (condition: SQL) => Promise<unknown>;
    };
  };
};

/** Options of {@link seedSpecialtiesMinzdrav}. */
export interface SeedSpecialtyBookOptions {
  /** The book to write. Defaults to {@link buildSpecialtyBookSeed}. */
  rows?: SpecialtyBookSeedRow[];
  /**
   * Pinned instant for `created_at` / `updated_at`.
   *
   * Omitted — the API boot path — the database clock decides, exactly as
   * before. Supplied — the `ds_golden` template build (#2063) — every book row
   * carries the same instant in every rebuild, so two template builds do not
   * differ in the book's timestamps.
   */
  now?: Date;
}

/**
 * Idempotent upsert of the whole book, keyed on `code`.
 *
 * Re-running it against an already-seeded database updates wording and frequent
 * ranks in place and keeps every `id` — the property that lets a doctor's stored
 * primary specialty survive a re-seed after an amended order. It never deletes:
 * withdrawing an entry that doctors may already hold is a migration decision,
 * not a seed side effect.
 *
 * A re-seed of UNCHANGED data writes nothing observable:
 *
 *  - the frequent-rank pre-clear skips every row that already holds the rank it
 *    is about to be given, so an unchanged book clears nothing;
 *  - the conflict branch moves `updated_at` only when a tracked column
 *    (`name`, `is_other`, `frequent_rank`) actually differs from the stored
 *    row, instead of stamping `now()` on every pass.
 *
 * That is what makes the golden template's drift rule hold on this table: a
 * second `seed:golden` against the same database leaves `specialties_minzdrav`
 * byte-identical.
 *
 * The frequent ranks are cleared FIRST, in the same transaction as the upsert.
 * `specialties_minzdrav_frequent_rank_key` is a NON-DEFERRABLE partial unique
 * index, so Postgres enforces it row-by-row inside the multi-row upsert: a
 * re-seed that merely REORDERS the frequent set (rank 3 -> 1 while the old
 * holder of 1 has not been rewritten yet) collides mid-statement, the whole
 * transaction rolls back, and — because the API seeds at boot and rethrows —
 * the service crash-loops. Nulling the moving ranks first makes every contested
 * rank free before any is claimed: a rank can only be contested by a row that
 * is itself moving, and every moving row is cleared. Still no deletes, still
 * idempotent: the caller must supply a transaction (the API bootstrap holds an
 * advisory lock on it), so the cleared state is never visible to a concurrent
 * reader.
 */
export async function seedSpecialtiesMinzdrav(
  db: SpecialtySeedExecutor,
  options: SeedSpecialtyBookOptions = {},
): Promise<number> {
  const rows = options.rows ?? buildSpecialtyBookSeed();
  const now = options.now;

  await db
    .update(specialtiesMinzdrav)
    .set({ frequentRank: null })
    .where(movingFrequentRanks(rows));

  const bumpTo = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;

  await db
    .insert(specialtiesMinzdrav)
    .values(
      rows.map((row) =>
        now ? { ...row, createdAt: now, updatedAt: now } : { ...row },
      ),
    )
    .onConflictDoUpdate({
      target: specialtiesMinzdrav.code,
      set: {
        name: sql`excluded.name`,
        isOther: sql`excluded.is_other`,
        frequentRank: sql`excluded.frequent_rank`,
        // NOTE: `id` is deliberately absent — a row that already exists keeps
        // the identity every stored reference to it resolves through.
        updatedAt: sql`case when (excluded.name, excluded.is_other, excluded.frequent_rank) is distinct from (${specialtiesMinzdrav.name}, ${specialtiesMinzdrav.isOther}, ${specialtiesMinzdrav.frequentRank}) then ${bumpTo} else ${specialtiesMinzdrav.updatedAt} end`,
      },
    });
  return rows.length;
}

/**
 * Rows whose frequent rank must be released before the upsert claims ranks:
 * every row that currently holds a rank it is NOT about to hold again.
 *
 * Narrower than «every ranked row» on purpose. Clearing a rank that the same
 * row immediately re-claims would make the conflict branch see a changed
 * `frequent_rank` and stamp `updated_at`, which is exactly the spurious write
 * the golden drift rule must not see.
 */
function movingFrequentRanks(rows: readonly SpecialtyBookSeedRow[]): SQL {
  const held = rows.filter((row) => row.frequentRank !== null);
  if (held.length === 0) {
    return sql`${specialtiesMinzdrav.frequentRank} is not null`;
  }
  const keeping = sql.join(
    held.map((row) => sql`(${row.code}, ${row.frequentRank})`),
    sql`, `,
  );
  return sql`${specialtiesMinzdrav.frequentRank} is not null and (${specialtiesMinzdrav.code}, ${specialtiesMinzdrav.frequentRank}) not in (${keeping})`;
}
