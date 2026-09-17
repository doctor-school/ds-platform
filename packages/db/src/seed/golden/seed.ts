// #2063 — the executor of the golden seed plan.
//
// Deliberately thin. Every decision (order, conflict targets, refreshed columns,
// referential soundness) lives in `plan.ts` and is unit-tested without a
// database; what remains here is the part that genuinely needs Postgres.

import { and, getTableColumns, gte, lte, sql } from "drizzle-orm";

import { registrations } from "../../schema/registrations.js";
import { GOLDEN_GROUP, goldenUuid } from "./ids.js";
import { GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";
import { specialtiesMinzdrav } from "../../schema/specialties.js";
import { seedSpecialtiesMinzdrav } from "../specialties-minzdrav.js";
import { buildGoldenDataset, GoldenDatasetError } from "./dataset.js";
import { resolveGoldenSubjects, type GoldenSubjectMap } from "./idp.js";
import {
  buildGoldenMediaPlan,
  writeGoldenMedia,
  type GoldenMediaStore,
} from "./media.js";
import { resolveGoldenNow } from "./now.js";
import {
  buildGoldenSeedPlan,
  goldenReferentialIssues,
  GoldenPlanError,
  type GoldenSeedStep,
} from "./plan.js";

/** Per-table row counts of one seed run. */
export interface GoldenSeedResult {
  now: string;
  steps: { name: string; rows: number }[];
  total: number;
  /** Objects PUT into the media store, or `null` when no store was supplied. */
  mediaWritten: number | null;
  /**
   * Objects the store already had and the plan left alone — the committed
   * portraits. Generated programmes are always re-PUT, so they never land here.
   */
  mediaSkipped: number | null;
  /** Objects the dataset's rows reference in total. */
  mediaPlanned: number;
}

/** The minimum of a Drizzle handle this module uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts both a db and a tx handle
type GoldenExecutor = any;

/**
 * Reads the Минздрав book as `name → id`.
 *
 * The golden dataset references specialties by name because their ids are
 * generated per database by the book seed (017). An empty book is a hard stop,
 * not an empty map: it means the migrations ran but the book seed did not, and
 * every doctor↔specialty link would be silently dropped.
 */
export async function loadSpecialtyIdByName(
  db: GoldenExecutor,
): Promise<Map<string, string>> {
  const rows: { id: string; name: string }[] = await db
    .select({ id: specialtiesMinzdrav.id, name: specialtiesMinzdrav.name })
    .from(specialtiesMinzdrav);
  if (rows.length === 0) {
    throw new GoldenPlanError(
      "specialties_minzdrav is empty — the Минздрав book seed must run before the golden seed",
    );
  }
  return new Map(rows.map((row) => [row.name, row.id]));
}

/** Executes one planned step as an idempotent upsert. */
export async function applyGoldenStep(
  tx: GoldenExecutor,
  step: GoldenSeedStep,
): Promise<number> {
  if (step.rows.length === 0) return 0;
  const columns = getTableColumns(step.table);

  const target = step.conflictKeys.map((key) => {
    const column = columns[key];
    if (!column) {
      throw new GoldenPlanError(
        `${step.name}: conflict key "${key}" is not a column of the table`,
      );
    }
    return column;
  });

  const set: Record<string, unknown> = {};
  for (const key of step.updateKeys) {
    const column = columns[key];
    if (!column) {
      throw new GoldenPlanError(
        `${step.name}: update key "${key}" is not a column of the table`,
      );
    }
    set[key] = sql.raw(`excluded."${column.name}"`);
  }

  await tx
    .insert(step.table)
    .values(step.rows)
    .onConflictDoUpdate({ target, set });
  return step.rows.length;
}

export interface RunGoldenSeedOptions {
  /** Defaults to `process.env`; the drift test injects a pinned `GOLDEN_NOW`. */
  env?: Record<string, string | undefined>;
  /** Pre-resolved subjects, for a caller that already asserted the IdP state. */
  subjects?: GoldenSubjectMap;
  /**
   * Seed the Минздрав book (017) in the same transaction first. Default `true`:
   * a freshly migrated template database has an empty book — in production the
   * API seeds it at boot, and the template build never boots the API — while the
   * golden doctor↔specialty links require it. The book seed is itself
   * idempotent, so running it here costs nothing on a re-seed.
   */
  ensureSpecialtyBook?: boolean;
  /**
   * Where expert portraits and programme PDFs are written.
   *
   * `run.ts` — the only production entry point — resolves an S3 store and
   * REFUSES to start without one, because the rows reference those objects
   * unconditionally. It stays optional here for the unit suite, which injects
   * an in-memory store, and for a caller that wants rows alone; a run without
   * it reports `mediaWritten: null` rather than pretending the objects exist.
   */
  media?: GoldenMediaStore;
}

/**
 * Seeds the golden dataset in ONE transaction.
 *
 * All-or-nothing on purpose: a half-written template database that still looks
 * buildable is worse than a failed build, because every preview slot cloned from
 * it would inherit the gap.
 */
export async function seedGolden(
  db: GoldenExecutor,
  options: RunGoldenSeedOptions = {},
): Promise<GoldenSeedResult> {
  const env = options.env ?? process.env;
  const now = resolveGoldenNow(env);
  const subjects = options.subjects ?? resolveGoldenSubjects(env);

  const dataset = buildGoldenDataset(now, subjects);
  const issues = goldenReferentialIssues(dataset);
  if (issues.length > 0) {
    throw new GoldenDatasetError(
      `golden dataset is not referentially sound:\n  ${issues.join("\n  ")}`,
    );
  }

  // Media BEFORE rows: a row that references an object which is not there yet
  // is a broken portrait and a 404 programme for as long as the gap lasts, and
  // an interrupted seed must never leave the database ahead of the bucket.
  const mediaPlan = await buildGoldenMediaPlan(dataset);
  const media = options.media
    ? await writeGoldenMedia(options.media, mediaPlan)
    : null;

  return db.transaction(async (tx: GoldenExecutor) => {
    if (options.ensureSpecialtyBook !== false) {
      await seedSpecialtiesMinzdrav(tx, { now });
    }
    const specialtyIdByName = await loadSpecialtyIdByName(tx);
    const plan = buildGoldenSeedPlan(dataset, specialtyIdByName);
    const steps: { name: string; rows: number }[] = [];
    for (const step of plan) {
      if (step.name === "registrations") {
        // A later pin reshuffles the volume (user,event) pairs among ordinal
        // ids. Updating them one by one can collide with another old ordinal.
        // Replace only our volume namespace, inside this same transaction;
        // named registrations and product-created UUIDs keep their identities.
        await tx
          .delete(registrations)
          .where(
            and(
              gte(
                registrations.id,
                goldenUuid(
                  GOLDEN_GROUP.registrations,
                  GOLDEN_VOLUME_ORDINAL_BASE,
                ),
              ),
              lte(
                registrations.id,
                goldenUuid(GOLDEN_GROUP.registrations, 0xffff_ffff_ffff),
              ),
            ),
          );
      }
      steps.push({ name: step.name, rows: await applyGoldenStep(tx, step) });
    }
    return {
      now: now.toISOString(),
      steps,
      total: steps.reduce((sum, s) => sum + s.rows, 0),
      mediaWritten: media?.written ?? null,
      mediaSkipped: media?.skipped ?? null,
      mediaPlanned: mediaPlan.length,
    };
  });
}
