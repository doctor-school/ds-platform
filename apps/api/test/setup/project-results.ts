import type pg from "pg";

/**
 * 030 EARS-17 — a public project is published AND declares at least one
 * result, so a fixture that wants its published project on a public read gives
 * it one result here. The kind is the migration-0055 seed «Школа» (FIXED id),
 * so every migrated test database has it without a per-suite insert.
 *
 * `project_results.project_id` is `ON DELETE RESTRICT`: a suite that seeds a
 * result deletes it (`deleteProjectResults`) before it deletes the project.
 */
export const TEST_OUTPUT_KIND_ID = "03000000-0000-4000-8000-000000000001";

/** Give one project a single result, making a published project public. */
export async function seedProjectResult(
  pool: pg.Pool,
  projectId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO project_results (project_id, output_kind_id, position, title)
     VALUES ($1, $2, 0, 'Итог')
     ON CONFLICT (project_id, position) DO NOTHING`,
    [projectId, TEST_OUTPUT_KIND_ID],
  );
}

/** Remove the results of the named projects, ahead of deleting the projects. */
export async function deleteProjectResults(
  pool: pg.Pool,
  projectIds: readonly string[],
): Promise<void> {
  if (projectIds.length === 0) return;
  await pool.query("DELETE FROM project_results WHERE project_id = ANY($1)", [
    projectIds,
  ]);
}
