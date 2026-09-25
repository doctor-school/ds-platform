import pg from "pg";

/**
 * 044 EARS-38 — bind a registrar to an event exactly the way the tech lead does
 * until the grants screen exists (#2378): the SQL runbook in
 * `apps/api/src/registration/README.md` → «Binding a registrar to an event»,
 * run against the stand database (`DATABASE_URL` — the branch database locally,
 * the job database in the `admin-e2e` CI job). There is no API writer for a
 * grant yet, so this is the production path, not a fixture shortcut.
 *
 * The `users` row is written by the 003 register call; it is polled for briefly
 * so a lagging write surfaces as a retry, and a binding that still inserts no
 * row fails loudly instead of leaving an unbound registrar behind.
 */
export async function bindRegistrarToEvent(
  registrarEmail: string,
  eventSlug: string,
): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("E2E requires DATABASE_URL in the environment");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      const result = await client.query(
        `INSERT INTO event_role_grants (user_id, role, event_id)
         SELECT u.id, 'event-registrar', e.id
         FROM users u, events e
         WHERE u.email = $1 AND e.slug = $2`,
        [registrarEmail, eventSlug],
      );
      if (result.rowCount === 1) return;
    }
    throw new Error(
      `could not bind ${registrarEmail} to ${eventSlug}: no users/events row matched`,
    );
  } finally {
    await client.end();
  }
}
