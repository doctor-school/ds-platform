// #2063 — the executor of the golden seed plan.
//
// Deliberately thin. Every decision (order, conflict targets, refreshed columns,
// referential soundness) lives in `plan.ts` and is unit-tested without a
// database; what remains here is the part that genuinely needs Postgres.

import {
  and,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { goldenUuid } from "./ids.js";
import { GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";
import { specialtiesMinzdrav } from "../../schema/specialties.js";
import { users, type NewUser } from "../../schema/users.js";
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

/**
 * Deletes the volume ordinal namespace of a step that declares it owns one.
 *
 * Runs inside the seed transaction, immediately before the step's upsert, so a
 * failure anywhere later restores every row it removed. The range is the id
 * group's volume ordinals ALONE: named catalogue rows live below
 * `GOLDEN_VOLUME_ORDINAL_BASE` and product-created rows carry no golden uuid,
 * so neither can fall inside it.
 *
 * This replaces a per-table name check in the writer loop: which tables need it
 * is a property of the plan (`replacesVolumeNamespace`), declared next to the
 * rows whose pairing walks with the pin.
 */
async function clearVolumeNamespace(
  tx: GoldenExecutor,
  step: GoldenSeedStep,
): Promise<void> {
  const group = step.replacesVolumeNamespace;
  if (group === undefined) return;
  const id = getTableColumns(step.table).id;
  if (!id) {
    throw new GoldenPlanError(
      `${step.name}: declares a volume namespace but has no "id" column`,
    );
  }
  const range = and(
    gte(id, goldenUuid(group, GOLDEN_VOLUME_ORDINAL_BASE)),
    lte(id, goldenUuid(group, 0xffff_ffff_ffff)),
  );
  // Declared children first, in plan order: they reference the range
  // `ON DELETE RESTRICT` (#1278), so the parent delete below would otherwise
  // abort the whole seed transaction.
  for (const child of step.volumeNamespaceChildren ?? []) {
    const parentColumn = getTableColumns(child.table)[child.parentKey];
    if (!parentColumn) {
      throw new GoldenPlanError(
        `${step.name}: child ${child.name} has no "${child.parentKey}" column`,
      );
    }
    await tx
      .delete(child.table)
      .where(
        inArray(parentColumn, tx.select({ id }).from(step.table).where(range)),
      );
  }
  await tx.delete(step.table).where(range);
}

/**
 * #2875 — adopts the IdP mirror's own row of a golden identity.
 *
 * Every slot api runs the reconcile sweep against the SHARED stage Zitadel
 * (`ReconcileService.sweep` → `UserMirrorService.upsert`), and the sweep mirrors
 * each enumerated account under a fresh uuid. A long-lived slot database (stage
 * `main`) therefore holds a golden account's row BEFORE the golden seed ever
 * writes it whenever the account is provisioned after that database was last
 * seeded — the #2805 worker pool, created by a PR slot's `reset-identities`, is
 * the first such case. The users upsert targets `id`, so that row would trip
 * `users_email_unique` / `users_zitadel_sub_unique`.
 *
 * Such a row is the same identity under a non-golden key and carries only what
 * Zitadel already holds, so it is removed and the golden row takes its place. A
 * row that has gathered product data (consents, registrations, …) is NOT
 * discarded: every FK into `users` is `ON DELETE RESTRICT`, and the refusal names
 * the identity so the operator decides.
 */
async function adoptMirroredGoldenIdentities(
  tx: GoldenExecutor,
  goldenUsers: readonly NewUser[],
): Promise<void> {
  const present = <T>(values: (T | null | undefined)[]): T[] =>
    values.filter((v): v is T => v !== null && v !== undefined);
  const ids = present(goldenUsers.map((u) => u.id));
  const subs = present(goldenUsers.map((u) => u.zitadelSub));
  const emails = present(goldenUsers.map((u) => u.email));
  const strays: { id: string; zitadelSub: string; email: string | null }[] =
    await tx
      .select({
        id: users.id,
        zitadelSub: users.zitadelSub,
        email: users.email,
      })
      .from(users)
      .where(
        and(
          notInArray(users.id, ids),
          or(inArray(users.zitadelSub, subs), inArray(users.email, emails)),
        ),
      );
  for (const stray of strays) {
    try {
      await tx.delete(users).where(eq(users.id, stray.id));
    } catch (err) {
      const cause =
        err instanceof Error && err.cause instanceof Error ? err.cause : err;
      throw new GoldenPlanError(
        `users: cannot adopt the IdP-mirrored row ${stray.id} of golden identity ${stray.email ?? stray.zitadelSub} — it already carries product data (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
  }
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
    await adoptMirroredGoldenIdentities(tx, dataset.users);
    for (const step of plan) {
      await clearVolumeNamespace(tx, step);
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
