// #2063 — the executor of the golden seed plan.
//
// Deliberately thin. Every decision (order, conflict targets, refreshed columns,
// referential soundness) lives in `plan.ts` and is unit-tested without a
// database; what remains here is the part that genuinely needs Postgres.

import { getTableColumns, sql } from "drizzle-orm";

import { specialtiesMinzdrav } from "../../schema/specialties.js";
import { seedSpecialtiesMinzdrav } from "../specialties-minzdrav.js";
import { buildGoldenDataset, GoldenDatasetError } from "./dataset.js";
import { resolveGoldenSubjects, type GoldenSubjectMap } from "./idp.js";
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

  return db.transaction(async (tx: GoldenExecutor) => {
    if (options.ensureSpecialtyBook !== false) {
      await seedSpecialtiesMinzdrav(tx);
    }
    const specialtyIdByName = await loadSpecialtyIdByName(tx);
    const plan = buildGoldenSeedPlan(dataset, specialtyIdByName);
    const steps: { name: string; rows: number }[] = [];
    for (const step of plan) {
      steps.push({ name: step.name, rows: await applyGoldenStep(tx, step) });
    }
    return {
      now: now.toISOString(),
      steps,
      total: steps.reduce((sum, s) => sum + s.rows, 0),
    };
  });
}
