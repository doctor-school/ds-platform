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
// raises — applying nothing — when a posting or a version above 1 exists.
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

    it("025 EARS-44: the guard raises when a posting exists, applying nothing", async () => {
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
        await client.query("SAVEPOINT guard");
        await expect(client.query(guardSql())).rejects.toThrow(
          /points_postings has rows/,
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
        const { rows } = await client.query<{ n: string }>(
          "SELECT count(*) AS n FROM points_postings",
        );
        // On a database with postings the first branch fires instead; both
        // branches refuse, which is the guarantee under test.
        await expect(client.query(guardSql())).rejects.toThrow(
          rows[0]?.n === "0"
            ? /version above 1 exists/
            : /points_postings has rows|version above 1 exists/,
        );
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);
