import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import {
  POINTS_ENGINE_SEED,
  POINTS_RETIRED_RULE_IDS,
  POINTS_RULE_DEFAULTS,
  pointsRuleTriggerFactTypes,
} from "@ds/schemas";

// 025 EARS-44 — migration 0060 against a real Postgres migrated through it:
// the 21 version-1 rows of 0059 are untouched, the engine seed equals
// `POINTS_ENGINE_SEED`, the seeded version is the one active at every
// instant, nothing is seeded for a retired id, and the migration's guard
// raises — applying nothing — when a version above 1 exists, while existing
// postings (immutable, citing their version-1 rule) do not block it.
//
// The guard is re-run from the migration file itself (between its
// `points-engine-guard:begin/end` markers) inside a rolled-back transaction,
// so the test proves the shipped SQL, not a copy.

const MIGRATION = fileURLToPath(
  new URL("../../drizzle/0060_points_engine.sql", import.meta.url),
);
const EPOCH = new Date("1970-01-01T00:00:00Z").getTime();

function guardSql(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const match =
    /-- points-engine-guard:begin\n([\s\S]*?)-- points-engine-guard:end/.exec(
      sql.replace(/\r\n/g, "\n"),
    );
  if (!match?.[1]) throw new Error("0060 guard markers not found");
  return match[1];
}

describe.skipIf(!process.env.DATABASE_URL)(
  "025 engine seed migration 0060 (e2e)",
  () => {
    let handle: DrizzleHandle;

    beforeAll(() => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 2 });
    });

    afterAll(async () => {
      await handle.pool.end();
    });

    it("025 EARS-44: every 0059 version-1 row is unchanged", async () => {
      const { rows } = await handle.pool.query<{
        rule_id: string;
        parameters: unknown;
        effective_from: Date;
        published_by: string | null;
        kind: string | null;
        trigger_fact_types: string[];
      }>(
        `SELECT rule_id, parameters, effective_from, published_by, kind, trigger_fact_types
           FROM points_rule_versions WHERE version = 1 AND rule_id = ANY($1)`,
        [Object.keys(POINTS_RULE_DEFAULTS)],
      );
      expect(rows).toHaveLength(21);
      for (const row of rows) {
        expect(row.parameters, row.rule_id).toEqual(
          POINTS_RULE_DEFAULTS[
            row.rule_id as keyof typeof POINTS_RULE_DEFAULTS
          ],
        );
        expect(row.effective_from.getTime(), row.rule_id).toBe(EPOCH);
        expect(row.published_by, row.rule_id).toBeNull();
        expect(row.kind, row.rule_id).toBeNull();
        expect(row.trigger_fact_types, row.rule_id).toEqual([]);
      }
    });

    it("025 EARS-44: the seeded rows equal POINTS_ENGINE_SEED, at the epoch, published by nobody", async () => {
      for (const seed of POINTS_ENGINE_SEED) {
        const { rows } = await handle.pool.query<{
          kind: string;
          trigger_fact_types: string[];
          parameters: unknown;
          effective_from: Date;
          published_by: string | null;
        }>(
          `SELECT kind, trigger_fact_types, parameters, effective_from, published_by
             FROM points_rule_versions WHERE rule_id = $1 AND version = $2`,
          [seed.ruleId, seed.version],
        );
        expect(rows, seed.ruleId).toHaveLength(1);
        const [row] = rows;
        expect(row?.kind, seed.ruleId).toBe(seed.body.kind);
        expect(row?.trigger_fact_types, seed.ruleId).toEqual(
          pointsRuleTriggerFactTypes(seed.body),
        );
        expect(row?.parameters, seed.ruleId).toEqual(seed.body);
        expect(row?.effective_from.getTime(), seed.ruleId).toBe(EPOCH);
        expect(row?.published_by, seed.ruleId).toBeNull();
      }
    });

    it("025 EARS-44: the seeded version is the one active at every instant; v1 of a mapped id is never selected", async () => {
      // Instants before any publish this database may have seen (other suites
      // publish at "now", never in the past), plus the epoch-dated rows — only
      // a migration writes one — at any time.
      const instants = [
        "1970-01-01T00:00:00Z",
        "2000-01-01T00:00:00Z",
        "2026-11-07T00:00:00Z",
      ];
      for (const seed of POINTS_ENGINE_SEED) {
        for (const at of instants) {
          const { rows } = await handle.pool.query<{ version: number }>(
            `SELECT version FROM points_rule_versions
              WHERE rule_id = $1 AND effective_from <= $2
              ORDER BY version DESC LIMIT 1`,
            [seed.ruleId, at],
          );
          expect(rows[0]?.version, `${seed.ruleId} at ${at}`).toBe(
            seed.version,
          );
        }
        const { rows: seeded } = await handle.pool.query<{ version: number }>(
          `SELECT max(version) AS version FROM points_rule_versions
            WHERE rule_id = $1 AND effective_from = 'epoch'`,
          [seed.ruleId],
        );
        expect(seeded[0]?.version, seed.ruleId).toBe(seed.version);
      }
      const { rows: triggered } = await handle.pool.query<{ rule_id: string }>(
        `SELECT DISTINCT rule_id FROM points_rule_versions
          WHERE trigger_fact_types && ARRAY['lesson.completed']::text[]
            AND effective_from = 'epoch'`,
      );
      expect(triggered.map((r) => r.rule_id).sort()).toEqual([
        "accrual.lesson",
        "accrual.lesson.any-mode",
        "accrual.referral-invitee",
        "accrual.referral-inviter",
      ]);
    });

    it("025 EARS-44: nothing is seeded for a retired 0059 id", async () => {
      const { rows } = await handle.pool.query<{ rule_id: string }>(
        `SELECT rule_id FROM points_rule_versions
          WHERE rule_id = ANY($1) AND version > 1 AND effective_from = 'epoch'`,
        [[...POINTS_RETIRED_RULE_IDS]],
      );
      expect(rows).toEqual([]);
    });

    it("025 EARS-44: the new rule-version columns are as immutable as the rest of the row", async () => {
      await expect(
        handle.pool.query(
          `UPDATE points_rule_versions SET trigger_fact_types = ARRAY['lesson.completed']
            WHERE rule_id = 'accrual.lesson' AND version = 1`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        handle.pool.query(
          `UPDATE points_rule_versions SET kind = 'rule'
            WHERE rule_id = 'accrual.lesson' AND version = 1`,
        ),
      ).rejects.toThrow(/immutable/);
    });

    it("025 EARS-44: an existing posting does not block the guard; only a version above 1 does", async () => {
      const client = await handle.pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: person } = await client.query<{ id: string }>(
          `INSERT INTO points_accounts (subject_kind, subject_id, unit)
           VALUES ('person', $1, 'attention_points') RETURNING id`,
          [randomUUID()],
        );
        const { rows: issuance } = await client.query<{ id: string }>(
          `SELECT id FROM points_accounts WHERE system_code = 'issuance' AND unit = 'attention_points'`,
        );
        const eventId = `seed-guard:${randomUUID()}`;
        await client.query(
          `INSERT INTO points_posting_keys (event_id, occurred_month) VALUES ($1, date_trunc('month', now())::date)`,
          [eventId],
        );
        await client.query(
          `INSERT INTO points_postings (event_id, leg, debit_account_id, credit_account_id, denomination, amount, rule_id, rule_version, occurred_at)
           VALUES ($1, 'accrual:pul', $2, $3, 'pul', 1, 'accrual.lesson', 1, now())`,
          [eventId, issuance[0]?.id, person[0]?.id],
        );
        // 0060 is applied here, so its own version-2 seed rows exist. A
        // temporary table shadows `points_rule_versions` (pg_temp is searched
        // first) with the 0059 rows only — the database the guard ran on.
        await client.query("SAVEPOINT guard");
        await client.query(
          `CREATE TEMP TABLE points_rule_versions ON COMMIT DROP AS
             SELECT * FROM public.points_rule_versions WHERE version = 1`,
        );
        // A posting exists and no version above 1: the guard passes.
        await client.query(guardSql());
        await client.query(
          `INSERT INTO points_rule_versions (rule_id, version, parameters, effective_from)
           VALUES ('accrual.lesson', 2, '{}'::jsonb, now())`,
        );
        await expect(client.query(guardSql())).rejects.toThrow(
          /version above 1 exists/,
        );
        await client.query("ROLLBACK TO SAVEPOINT guard");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("025 EARS-44: the guard raises when a version above 1 exists (the seed's own, once applied)", async () => {
      const client = await handle.pool.connect();
      try {
        await client.query("BEGIN");
        await expect(client.query(guardSql())).rejects.toThrow(
          /version above 1 exists/,
        );
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);
