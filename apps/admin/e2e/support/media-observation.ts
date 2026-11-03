import type { Pool } from "pg";

export type Cleanup = {
  id: string;
  cleanup_kind: string;
  entity_kind: string;
  entity_id: string | null;
  slot: string;
  object_key: string | null;
  status: string;
  execution_state: string;
};

export async function cleanupInventory(pool: Pool, log: (op: string) => void) {
  const sql = "SELECT id FROM media_cleanup_jobs ORDER BY id";
  log(`SELECT ${sql}`);
  return (await pool.query<{ id: string }>(sql)).rows.map((row) => row.id);
}

// 012 EARS-21: completion clears entity_id and locators, never the retained id.
// The serial test's pre-command inventory also finds a job completed before its
// first observation; an unexpected concurrent insertion fails the exact counts.
export async function mediaObservation(
  pool: Pool,
  projectId: string,
  jobIds: string[],
  beforeJobIds: string[] | null,
  log: (op: string) => void,
) {
  const sql =
    "SELECT cover_ref,version,COALESCE((SELECT json_agg(j ORDER BY COALESCE(array_position($2::uuid[],j.id),2147483647),j.created_at,j.id) FROM (SELECT id,cleanup_kind,entity_kind,entity_id,slot,object_key,status,execution_state,created_at FROM media_cleanup_jobs WHERE id=ANY($2::uuid[]) OR ($3::uuid[] IS NOT NULL AND NOT(id=ANY($3::uuid[])))) j),'[]'::json) AS jobs FROM projects WHERE id=$1";
  log(`SELECT ${sql}`);
  const rows = (
    await pool.query<{
      cover_ref: string | null;
      version: number;
      jobs: Cleanup[];
    }>(sql, [projectId, jobIds, beforeJobIds])
  ).rows;
  if (rows.length !== 1) throw new Error("Owned media project is missing");
  return {
    ref: rows[0]!.cover_ref,
    version: rows[0]!.version,
    jobs: rows[0]!.jobs,
  };
}
