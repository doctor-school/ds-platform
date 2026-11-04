import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { expect } from "@playwright/test";
import { createBdd, test as base } from "playwright-bdd";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { AUDIT_CAPTURE_ALLOWLIST } from "../../../../packages/db/src/audit";

type JsonRow = Record<string, unknown>;
type LedgerRow = JsonRow & {
  id: string;
  event_id: string;
  event_type: string;
  metadata: {
    pk: { id: string };
    diff: Record<string, { old?: unknown; new?: unknown }>;
  };
};
type AuditWorld = {
  query: <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ) => Promise<T[]>;
  client: PoolClient;
  event?: JsonRow & { id: string };
  ledger?: LedgerRow;
  refusals: { code: string; message: string }[];
};

function operation(sql: string): void {
  const file = process.env.E2E_EDIT_AUDIT_LOG;
  if (!file) throw new Error("E2E_EDIT_AUDIT_LOG must name the operation log");
  appendFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), sql }) + "\n",
  );
}

export const test = base.extend<{ audit: AuditWorld }>({
  // eslint-disable-next-line no-empty-pattern -- bddgen recognizes this fixture shape
  audit: async ({}, use) => {
    const database = process.env.E2E_EDIT_AUDIT_DATABASE;
    const connection = process.env.DATABASE_URL;
    if (
      !database ||
      !connection ||
      !(
        /^ds_dev_\d+$/.test(database) ||
        (process.env.CI === "true" && database === "ds_admin_e2e")
      ) ||
      decodeURIComponent(new URL(connection).pathname.slice(1)) !== database
    ) {
      throw new Error(
        "Audit fixtures require an explicitly owned disposable DB",
      );
    }
    const application = "ds-e2e-edit-audit";
    operation("CONNECT owned edit-audit database");
    const pool = new Pool({
      connectionString: connection,
      application_name: application,
      max: 1,
    });
    const client = await pool.connect();
    const query: AuditWorld["query"] = async (sql, values = []) => {
      operation(
        "SELECT current_database(), current_setting('application_name')",
      );
      const binding = await client.query<{ name: string; application: string }>(
        "SELECT current_database() AS name, current_setting('application_name') AS application",
      );
      expect(binding.rows).toEqual([{ name: database, application }]);
      operation(sql);
      return (await client.query(sql, values)).rows;
    };
    try {
      await query("BEGIN");
      await use({ query, client, refusals: [] });
    } finally {
      // The same checked connection may be in an aborted transaction after a failed assertion.
      operation("ROLLBACK");
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
});

const { Given, When, Then } = createBdd(test);

Given(
  "the audit trigger function is attached to every audited domain table by migration",
  async ({ audit }) => {
    const tables = await audit.query<{ name: string; capture: boolean }>(
      `SELECT c.relname AS name,
              EXISTS (
                SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                 WHERE t.tgrelid = c.oid AND p.proname = 'audit_row_change'
                   AND t.tgtype = 29 AND t.tgenabled IN ('O', 'A')
              ) AS capture
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND NOT c.relispartition
        ORDER BY c.relname`,
    );
    expect(tables.map(({ name }) => name)).toContain("events");
    const excluded = new Set(AUDIT_CAPTURE_ALLOWLIST.map(({ table }) => table));
    expect(
      tables.filter(({ name, capture }) => !excluded.has(name) && !capture),
    ).toEqual([]);
  },
);

Given(
  "the audit_ledger append-only enforcement trigger is active",
  async ({ audit }) => {
    const partitions = await audit.query<{ name: string; enforced: boolean }>(
      `SELECT c.relname AS name,
            EXISTS (
              SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
               WHERE t.tgrelid = tree.relid AND p.proname = 'audit_ledger_append_only'
                 AND t.tgtype = 27 AND t.tgenabled IN ('O', 'A')
            ) AS enforced
       FROM pg_partition_tree('public.audit_ledger') tree
       JOIN pg_class c ON c.oid = tree.relid`,
    );
    expect(partitions.map(({ name }) => name)).toContain("audit_ledger");
    expect(partitions.every(({ enforced }) => enforced)).toBe(true);
  },
);

async function insertEvent(audit: AuditWorld): Promise<void> {
  const [row] = await audit.query<{ row: JsonRow & { id: string } }>(
    `INSERT INTO events
       (slug, title, school, starts_at, duration_min, description, specialties,
        partner_ref, venue, program_pdf_ref, kind_id, audience,
        participation_format, seats_left, recording_expected_by)
     VALUES ($1, 'Audit original title', 'audit-contract', now() + interval '1 day',
             75, 'Full audit fixture', ARRAY['audit-specialty'], 'audit-partner',
             'audit-venue', 'audit-contract/program.pdf',
             (SELECT id FROM event_kinds WHERE 'online' = ANY(allowed_formats)
               AND status = 'published' ORDER BY slug LIMIT 1),
             'experts', 'online', 12, CURRENT_DATE + 2)
     RETURNING to_jsonb(events) AS row`,
    [`edit-audit-${randomUUID()}`],
  );
  expect(row).toBeDefined();
  audit.event = row!.row;
}

Given("an existing event row with a full field set", async ({ audit }) => {
  await insertEvent(audit);
});
Given("an existing event row", async ({ audit }) => {
  await insertEvent(audit);
});

When("the row is deleted through any write path", async ({ audit }) => {
  expect(audit.event).toBeDefined();
  const deleted = await audit.query(
    "DELETE FROM events WHERE id = $1 RETURNING id",
    [audit.event!.id],
  );
  expect(deleted).toEqual([{ id: audit.event!.id }]);
});

Then(
  'one audit_ledger row with event_type "data.events.delete" is appended',
  async ({ audit }) => {
    const rows = await audit.query<{ row: LedgerRow }>(
      `SELECT to_jsonb(audit_ledger) AS row FROM audit_ledger
      WHERE event_type = 'data.events.delete' AND metadata -> 'pk' ->> 'id' = $1`,
      [audit.event!.id],
    );
    expect(rows).toHaveLength(1);
    audit.ledger = rows[0]!.row;
  },
);

Then(
  /^its metadata\.diff carries every column of the deleted row as \{field: \{old: value\}\}$/,
  async ({ audit }) => {
    expect(audit.ledger!.metadata.diff).toEqual(
      Object.fromEntries(
        Object.entries(audit.event!).map(([key, old]) => [key, { old }]),
      ),
    );
  },
);

Then(
  "the deleted record is reconstructible from that diff alone",
  async ({ audit }) => {
    const restored = Object.fromEntries(
      Object.entries(audit.ledger!.metadata.diff).map(([key, value]) => [
        key,
        value.old,
      ]),
    );
    expect(restored).toEqual(audit.event);
    expect(
      await audit.query("SELECT id FROM events WHERE id = $1", [restored.id]),
    ).toEqual([]);
  },
);

When(
  /^an UPDATE writes the same values back \(only updated_at is touched\)$/,
  async ({ audit }) => {
    const [row] = await audit.query<{ row: JsonRow }>(
      `UPDATE events SET title = title, updated_at = updated_at + interval '1 second'
      WHERE id = $1 RETURNING to_jsonb(events) AS row`,
      [audit.event!.id],
    );
    expect(row!.row.updated_at).not.toEqual(audit.event!.updated_at);
    const { updated_at: before, ...unchanged } = audit.event!;
    expect({ ...row!.row, updated_at: before }).toEqual({
      ...unchanged,
      updated_at: before,
    });
  },
);

Then(
  "no audit_ledger row is appended for that statement",
  async ({ audit }) => {
    const rows = await audit.query<{ event_type: string }>(
      "SELECT event_type FROM audit_ledger WHERE metadata -> 'pk' ->> 'id' = $1",
      [audit.event!.id],
    );
    expect(rows).toEqual([{ event_type: "data.events.insert" }]);
  },
);

Given(
  'an existing audit_ledger row with event_type "data.events.update"',
  async ({ audit }) => {
    await insertEvent(audit);
    await audit.query(
      "UPDATE events SET title = 'Audit advanced title' WHERE id = $1",
      [audit.event!.id],
    );
    const rows = await audit.query<{ row: LedgerRow }>(
      `SELECT to_jsonb(audit_ledger) AS row FROM audit_ledger
      WHERE event_type = 'data.events.update' AND metadata -> 'pk' ->> 'id' = $1`,
      [audit.event!.id],
    );
    expect(rows).toHaveLength(1);
    audit.ledger = rows[0]!.row;
  },
);

When(
  "an UPDATE or DELETE is attempted against that ledger row",
  async ({ audit }) => {
    for (const sql of [
      "UPDATE audit_ledger SET subject_id = 'tampered' WHERE id = $1 AND event_id = $2",
      "DELETE FROM audit_ledger WHERE id = $1 AND event_id = $2",
    ]) {
      await audit.query("SAVEPOINT audit_refusal");
      try {
        await audit.query(sql, [audit.ledger!.id, audit.ledger!.event_id]);
        throw new Error("Append-only mutation unexpectedly succeeded");
      } catch (error) {
        const failure = error as { code?: string; message: string };
        if (!failure.code) throw error;
        audit.refusals.push({ code: failure.code, message: failure.message });
      } finally {
        // A refused statement aborts this savepoint; it cannot run a binding SELECT first.
        operation("ROLLBACK TO SAVEPOINT audit_refusal");
        await audit.client.query("ROLLBACK TO SAVEPOINT audit_refusal");
        await audit.query("RELEASE SAVEPOINT audit_refusal");
      }
      const unchanged = await audit.query<{ row: LedgerRow }>(
        "SELECT to_jsonb(audit_ledger) AS row FROM audit_ledger WHERE id = $1 AND event_id = $2",
        [audit.ledger!.id, audit.ledger!.event_id],
      );
      expect(unchanged.map(({ row }) => row)).toEqual([audit.ledger]);
    }
  },
);

Then(
  "the statement is refused by the append-only enforcement trigger",
  async ({ audit }) => {
    expect(audit.refusals).toHaveLength(2);
    expect(audit.refusals.map(({ code }) => code)).toEqual(["P0001", "P0001"]);
    expect(audit.refusals[0]!.message).toMatch(
      /audit_ledger is append-only.*UPDATE prohibited/,
    );
    expect(audit.refusals[1]!.message).toMatch(
      /audit_ledger is append-only.*DELETE prohibited/,
    );
  },
);

Then(
  "a correction can only be expressed as a new compensating record",
  async ({ audit }) => {
    await audit.query(
      "UPDATE events SET title = 'Audit corrected title' WHERE id = $1",
      [audit.event!.id],
    );
    const rows = await audit.query<{ row: LedgerRow }>(
      `SELECT to_jsonb(audit_ledger) AS row FROM audit_ledger
      WHERE event_type = 'data.events.update' AND metadata -> 'pk' ->> 'id' = $1`,
      [audit.event!.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find(({ row }) => row.id === audit.ledger!.id)!.row).toEqual(
      audit.ledger,
    );
    const correction = rows.find(({ row }) => row.id !== audit.ledger!.id)!.row;
    expect(correction.event_id).not.toBe(audit.ledger!.event_id);
    expect(correction.metadata.diff).toEqual({
      title: { old: "Audit advanced title", new: "Audit corrected title" },
    });
  },
);
