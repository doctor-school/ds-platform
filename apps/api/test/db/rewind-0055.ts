import type pg from "pg";

/**
 * The exact inverse of `0055_projects_catalog.sql` (030 EARS-17, #3503), for
 * the migration harnesses that rewind the schema past it inside a transaction
 * that is always rolled back (`organisations-migration`, `event-kinds-migration`,
 * `projects-catalog-migration`).
 *
 * Rows created after 0055 carry no former 012 kind; the rewound `kind` column
 * is NOT NULL again, so those rows get the first 012 kind — inside the same
 * rolled-back transaction, so nothing survives.
 */
export async function rewindToPre0055(c: pg.PoolClient): Promise<void> {
  await c.query(`DROP TABLE "project_results"`);
  await c.query(`DROP TABLE "project_output_kinds"`);
  await c.query(`DROP TYPE "project_output_kind_status"`);
  await c.query(
    `ALTER TABLE "project_organisations" DROP CONSTRAINT "project_organisations_note_bounds"`,
  );
  await c.query(`DROP INDEX "project_organisations_role_id_idx"`);
  await c.query(
    `ALTER TABLE "project_organisations" DROP CONSTRAINT "project_organisations_role_id_organisation_roles_id_fk"`,
  );
  await c.query(
    `ALTER TABLE "project_organisations" DROP COLUMN "role_id", DROP COLUMN "note"`,
  );
  await c.query(
    `ALTER TABLE "projects" RENAME COLUMN "legacy_kind" TO "kind"`,
  );
  await c.query(
    `UPDATE "projects" SET "kind" = 'school' WHERE "kind" IS NULL`,
  );
  await c.query(`ALTER TABLE "projects" ALTER COLUMN "kind" SET NOT NULL`);
  await c.query(
    `ALTER TABLE "projects" DROP CONSTRAINT "projects_stage_note_iff_soon", DROP CONSTRAINT "projects_stage_note_bounds"`,
  );
  await c.query(
    `ALTER TABLE "projects" DROP COLUMN "stage", DROP COLUMN "stage_note", DROP COLUMN "display_position"`,
  );
  await c.query(`DROP TYPE "project_stage"`);
}
