export async function completePointsSnapshot(pool: {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
}) {
  const read = async (table: string, order: string) =>
    (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
  return {
    accounts: await read("points_accounts", "id"),
    journal: await read("points_facts", "event_id"),
    keys: await read("points_posting_keys", "event_id"),
    postings: await read("points_postings", "event_id,leg"),
    holds: await read("points_reserves", "registration_id"),
    obligations: await read("points_obligations", "id"),
  };
}
