import type pg from "pg";

/**
 * #1278 — e2e fixture teardown for the RETAINED aggregates (ADR-0003 design
 * §3.6).
 *
 * Every FK into `users` and `events` is now `ON DELETE RESTRICT`: production
 * never physically removes a retained row, so the database refuses to sweep a
 * parent's children away implicitly. A test database is the one place where rows
 * ARE physically removed (the suite owns its fixtures and must leave the shared
 * branch DB as it found it), so the teardown has to name the children itself, in
 * FK order — the guard that protects production data is exactly what makes a
 * bare `DELETE FROM users WHERE …` fail here.
 *
 * These helpers are the single place that order is written down. They are test
 * infrastructure only: no production path calls them, and no production path may
 * (`tools/lint/retained-data-lint.ts` allowlists `apps/api/test/**` for that
 * reason).
 */

/**
 * Tables whose physical removal is refused by a DATABASE trigger, not only by an
 * FK. `event_speakers` carries the 012 EARS-24 migration fence
 * (`event_speakers_migration_fence_before_write`, migration 0031): DELETE is
 * refused in EVERY phase because a source row is the retained provenance the
 * migration review queue is keyed by.
 *
 * That rule is about application DML — a legacy image, a service method, a
 * forgotten script. Fixture teardown is none of those: it is a DBA-level
 * operation on a disposable branch database, and it announces itself as one by
 * setting `session_replication_role = 'replica'` for the duration of ONE
 * transaction, which is Postgres's own switch for "this session is not the
 * application". It is `SET LOCAL`, so it cannot leak past the transaction, and
 * it is confined to this file — no production path can reach it
 * (`tools/lint/retained-data-lint.ts` allowlists `apps/api/test/**`).
 */
const FENCED_TABLES = new Set(["event_speakers"]);

/**
 * Run `fn` with user triggers suspended for one transaction, on a dedicated
 * client. Test-teardown infrastructure ONLY — see `FENCED_TABLES`.
 */
export async function withFenceBypass<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Physically remove the retained `event_speakers` rows of one event fixture.
 * The single sanctioned way for a suite to do that — see `withFenceBypass`.
 */
export async function deleteEventSpeakersFixture(
  pool: pg.Pool,
  eventId: string,
): Promise<void> {
  await withFenceBypass(pool, (client) =>
    client.query("DELETE FROM event_speakers WHERE event_id = $1", [eventId]),
  );
}

/** Child tables of `events`, in the order they must be removed. */
const EVENT_CHILDREN = [
  "presence_beats",
  "registrations",
  "event_speakers",
  "stream_config",
  "event_recordings",
  // 012 EARS-6 (#1288) — the event↔project relationship. Its FK into `events`
  // is `ON DELETE RESTRICT` like every other retained child, so an event
  // fixture that was ever related to a project cannot be swept away until the
  // relationship row is named here first.
  "event_projects",
] as const;

/** Child tables of `users`, in the order they must be removed. */
const USER_CHILDREN = [
  "presence_beats",
  "registrations",
  "consent_records",
] as const;

/**
 * Remove one event fixture and everything that references it. Safe to call for
 * an id that no longer exists (each statement simply matches no row).
 */
export async function deleteEventFixture(
  pool: pg.Pool,
  eventId: string,
): Promise<void> {
  for (const table of EVENT_CHILDREN) {
    if (FENCED_TABLES.has(table)) {
      await deleteEventSpeakersFixture(pool, eventId);
      continue;
    }
    await pool.query(`DELETE FROM ${table} WHERE event_id = $1`, [eventId]);
  }
  await pool.query("DELETE FROM events WHERE id = $1", [eventId]);
}

/**
 * Remove one user fixture and everything that references it, selected by the
 * natural key the suite happens to hold (`email`, `phone` or `zitadel_sub`).
 */
export async function deleteUserFixture(
  pool: pg.Pool,
  by: "email" | "phone" | "zitadel_sub",
  value: string,
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE ${by} = $1`,
    [value],
  );
  for (const row of rows) {
    for (const table of USER_CHILDREN)
      await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [row.id]);
    await pool.query("DELETE FROM users WHERE id = $1", [row.id]);
  }
}
