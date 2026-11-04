import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";
import { createBdd, test as base } from "playwright-bdd";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { AUDIT_CAPTURE_ALLOWLIST } from "../../../../packages/db/src/audit";
import { nativePsql } from "../../../../packages/e2e/api-probes/native-pg.js";

type JsonRow = Record<string, unknown>;
type LedgerRow = JsonRow & {
  id: string;
  event_id: string;
  event_type: string;
  subject_id: string | null;
  metadata: {
    source: string;
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
  native?: ReturnType<typeof nativePsql>;
  registration?: { id: string; registered_at: string };
  written?: { id: string; registered_at: string };
  guard?: { code: number | null; stdout: string; stderr: string };
  guardFixture?: string;
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
    const world: AuditWorld = { query, client, refusals: [] };
    try {
      await query("BEGIN");
      await use(world);
    } finally {
      await world.native?.close();
      // The same checked connection may be in an aborted transaction after a failed assertion.
      operation("ROLLBACK");
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
});

const { Given, When, Then } = createBdd(test);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
function coverageGuard(fixture: string) {
  operation(`RUN native audit-coverage-lint fixture ${fixture}`);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", resolve(root, "tools/lint/audit-coverage-lint.ts")],
    {
      cwd: root,
      env: { ...process.env, LINT_FIXTURE_ROOT: fixture },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  operation(
    JSON.stringify({
      fixture,
      exit: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

Given(
  "a psql session on the dev stand with no app.actor_sub or app.source set",
  async ({ audit }) => {
    audit.native = nativePsql(process.env.E2E_EDIT_AUDIT_DATABASE!, (event) =>
      operation(JSON.stringify(event)),
    );
    const context = JSON.parse(
      await audit.native.query(`BEGIN;
    SELECT json_build_object('database', current_database(), 'actor', current_setting('app.actor_sub', true), 'source', current_setting('app.source', true));`),
    );
    expect(context).toEqual({
      database: process.env.E2E_EDIT_AUDIT_DATABASE,
      actor: null,
      source: null,
    });
  },
);

When(
  "the session updates a registration row with a raw UPDATE statement",
  async ({ audit }) => {
    const slug = `direct-audit-${randomUUID()}`;
    const result = await audit.native!.query(`
    INSERT INTO events (slug, title, school, starts_at, duration_min, kind_id, audience) VALUES ('${slug}', 'Direct SQL audit fixture', 'audit-contract', now() + interval '1 day', 60,
      (SELECT id FROM event_kinds WHERE 'online' = ANY(allowed_formats) AND status = 'published' ORDER BY slug LIMIT 1), 'experts');
    INSERT INTO users (zitadel_sub, email) VALUES ('${slug}', '${slug}@example.invalid');
    INSERT INTO registrations (user_id, event_id) SELECT u.id, e.id FROM users u, events e WHERE u.zitadel_sub = '${slug}' AND e.slug = '${slug}';
    SELECT json_build_object('id', r.id, 'registered_at', r.registered_at::text) FROM registrations r JOIN events e ON e.id=r.event_id WHERE e.slug='${slug}';
    SELECT json_build_object('actor', current_setting('app.actor_sub', true), 'source', current_setting('app.source', true));
    UPDATE registrations SET registered_at = registered_at + interval '1 second' WHERE event_id = (SELECT id FROM events WHERE slug = '${slug}') RETURNING json_build_object('id', id, 'registered_at', registered_at::text);
    SELECT to_jsonb(a) FROM audit_ledger a WHERE event_type = 'data.registrations.update' AND metadata->'pk'->>'id' = (SELECT r.id::text FROM registrations r JOIN events e ON e.id=r.event_id WHERE e.slug='${slug}');
  `);
    const rows = result
      .split(/\r?\n/)
      .filter(Boolean)
      .map((row) => JSON.parse(row));
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({ actor: null, source: null });
    audit.registration = rows[0];
    audit.written = rows[2];
    audit.ledger = rows[3];
  },
);

Then("the domain write succeeds", async ({ audit }) => {
  expect(audit.written!.id).toBe(audit.registration!.id);
  expect(
    Date.parse(audit.written!.registered_at) -
      Date.parse(audit.registration!.registered_at),
  ).toBe(1000);
});
Then(
  'one audit_ledger row with event_type "data.registrations.update" is appended',
  async ({ audit }) => {
    expect(audit.ledger!.event_type).toBe("data.registrations.update");
    expect(audit.ledger!.metadata.pk).toEqual({ id: audit.registration!.id });
    expect(Object.keys(audit.ledger!.metadata.diff)).toEqual(["registered_at"]);
  },
);
Then('its metadata.source is "db-direct"', async ({ audit }) => {
  expect(audit.ledger!.metadata.source).toBe("db-direct");
});
Then("its subject_id is NULL", async ({ audit }) => {
  expect(audit.ledger!.subject_id).toBeNull();
});
Then("no actor is fabricated", async ({ audit }) => {
  expect(audit.ledger!.subject_id).toBeNull();
  expect(audit.ledger!.metadata).not.toHaveProperty("actor");
  expect(audit.ledger!.metadata).not.toHaveProperty("actor_sub");
});

Given(
  "a fixture schema declaring a new domain table with no audit trigger attachment and no allowlist entry",
  async ({ audit }) => {
    audit.guardFixture = resolve(
      root,
      "tools/lint/guard-tests/fixtures/audit-coverage/red-uncovered",
    );
    expect(
      readFileSync(
        resolve(audit.guardFixture, "packages/db/src/schema/c.ts"),
        "utf8",
      ),
    ).toContain('pgTable("widget_c"');
  },
);
When("the audit-coverage lint runs in CI", async ({ audit }) => {
  audit.guard = coverageGuard(audit.guardFixture!);
});
Then("the check fails red naming the uncovered table", async ({ audit }) => {
  expect(audit.guard!.code).toBe(1);
  expect(audit.guard!.stderr).toContain("widget_c");
});
Then(
  "it passes only when the table gains a trigger-attach migration line or an allowlist entry carrying a recorded rationale",
  async () => {
    const scratch = process.env.E2E_EDIT_AUDIT_SCRATCH;
    if (!scratch)
      throw new Error(
        "E2E_EDIT_AUDIT_SCRATCH must name the owned scratch directory",
      );
    mkdirSync(scratch, { recursive: true });
    const fixture = mkdtempSync(resolve(scratch, "audit-guard-"));
    try {
      cpSync(
        resolve(
          root,
          "tools/lint/guard-tests/fixtures/audit-coverage/red-uncovered",
        ),
        fixture,
        { recursive: true },
      );
      const migration = resolve(fixture, "apps/api/drizzle/0001_init.sql");
      const original = readFileSync(migration, "utf8");
      writeFileSync(
        migration,
        original +
          '\nCREATE TRIGGER widget_c_audit AFTER INSERT OR UPDATE OR DELETE ON "widget_c" FOR EACH ROW EXECUTE FUNCTION audit_row_change();\n',
      );
      expect(coverageGuard(fixture).code).toBe(0);
      writeFileSync(migration, original);
      const registry = resolve(fixture, "packages/db/src/audit.ts");
      writeFileSync(
        registry,
        'export const AUDIT_CAPTURE_ALLOWLIST = [{table:"widget_c",rationale:"Derived cache; no independent domain truth"}];\n',
      );
      expect(coverageGuard(fixture).code).toBe(0);
      writeFileSync(
        registry,
        'export const AUDIT_CAPTURE_ALLOWLIST = [{table:"widget_c",rationale:""}];\n',
      );
      const bare = coverageGuard(fixture);
      expect(bare.code).toBe(1);
      expect(bare.stderr).toContain("widget_c");
      expect(bare.stderr).toContain("rationale");
      const convention = resolve(
        root,
        "tools/lint/guard-tests/fixtures/audit-coverage",
      );
      expect(coverageGuard(resolve(convention, "green")).code).toBe(0);
      expect(
        coverageGuard(resolve(convention, "red-bare-allowlist")).code,
      ).toBe(1);
    } finally {
      rmSync(fixture, { recursive: true });
    }
  },
);

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
