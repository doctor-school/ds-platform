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
// `POINTS_ENGINE_SEED`, each seeded row is numbered max(version) + 1 for its
// id and is the version active at every instant, nothing is seeded for a
// retired id, and the migration carries no refusing guard — neither an
// existing posting nor an existing version above 1 blocks it.
//
// A seed row is told apart by `effective_from = epoch AND kind IS NOT NULL`:
// the 0059 rows carry no kind and an admin publish is never back-dated
// (EARS-25). The seed INSERT and its closing NOTICE are re-run from the
// migration file itself (between their `points-engine-seed` and
// `points-engine-notice` markers) inside a rolled-back transaction, so the
// test proves the shipped SQL, not a copy.

const MIGRATION = fileURLToPath(
  new URL("../../drizzle/0060_points_engine.sql", import.meta.url),
);
const EPOCH = new Date("1970-01-01T00:00:00Z").getTime();
const SEED_ROW = `effective_from = 'epoch' AND kind IS NOT NULL`;

function migrationBlock(name: "seed" | "notice"): string {
  const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
  const begin = `-- points-engine-${name}:begin\n`;
  const start = sql.indexOf(begin);
  const end = sql.indexOf(`-- points-engine-${name}:end`, start);
  if (start < 0 || end < 0) throw new Error(`0060 ${name} markers not found`);
  return sql.slice(start + begin.length, end);
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
             FROM points_rule_versions WHERE rule_id = $1 AND ${SEED_ROW}`,
          [seed.ruleId],
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

    it("025 EARS-44: each seeded version is max(version) + 1 for its id and the one active at every instant", async () => {
      // Instants before any publish this database may have seen (other suites
      // publish at "now", never in the past); only a migration writes an
      // epoch-dated row.
      const instants = [
        "1970-01-01T00:00:00Z",
        "2000-01-01T00:00:00Z",
        "2026-11-07T00:00:00Z",
      ];
      for (const seed of POINTS_ENGINE_SEED) {
        const { rows: own } = await handle.pool.query<{ version: number }>(
          `SELECT version FROM points_rule_versions WHERE rule_id = $1 AND ${SEED_ROW}`,
          [seed.ruleId],
        );
        const version = own[0]?.version;
        expect(version, seed.ruleId).toBeDefined();
        // Versions are contiguous: every one below the seed's is stored.
        const { rows: below } = await handle.pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM points_rule_versions
            WHERE rule_id = $1 AND version < $2`,
          [seed.ruleId, version],
        );
        expect(Number(below[0]?.n) + 1, seed.ruleId).toBe(version);
        for (const at of instants) {
          const { rows } = await handle.pool.query<{ version: number }>(
            `SELECT version FROM points_rule_versions
              WHERE rule_id = $1 AND effective_from <= $2
              ORDER BY version DESC LIMIT 1`,
            [seed.ruleId, at],
          );
          expect(rows[0]?.version, `${seed.ruleId} at ${at}`).toBe(version);
        }
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
          WHERE rule_id = ANY($1) AND ${SEED_ROW}`,
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

    it("025 EARS-44: the seed numbers each row max(version) + 1 — an existing posting and an existing version 2 block nothing, and every earlier row stays unchanged", async () => {
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
        const eventId = `seed-v2:${randomUUID()}`;
        await client.query(
          `INSERT INTO points_posting_keys (event_id, occurred_month) VALUES ($1, date_trunc('month', now())::date)`,
          [eventId],
        );
        await client.query(
          `INSERT INTO points_postings (event_id, leg, debit_account_id, credit_account_id, denomination, amount, rule_id, rule_version, occurred_at)
           VALUES ($1, 'accrual:pul', $2, $3, 'pul', 1, 'accrual.lesson', 1, now())`,
          [eventId, issuance[0]?.id, person[0]?.id],
        );
        // 0060 is applied here, so its own seed rows exist. A temporary table
        // shadows `points_rule_versions` (pg_temp is searched first) with the
        // 0059 rows plus a version 2 an earlier e2e run published — the
        // database the seed meets on a dev or stage stand.
        await client.query(
          `CREATE TEMP TABLE points_rule_versions ON COMMIT DROP AS
             SELECT * FROM public.points_rule_versions WHERE version = 1 AND kind IS NULL`,
        );
        await client.query(
          `INSERT INTO points_rule_versions (rule_id, version, parameters, effective_from)
           VALUES ('accrual.lesson', 2, '{"e2e":true}'::jsonb, now() - interval '1 day')`,
        );
        const listAll = `SELECT rule_id, version, parameters, effective_from FROM points_rule_versions`;
        const { rows: before } = await client.query(
          `${listAll} ORDER BY rule_id, version`,
        );

        await client.query(migrationBlock("seed"));

        const { rows: seededRows } = await client.query<{
          rule_id: string;
          version: number;
          parameters: unknown;
        }>(`SELECT rule_id, version, parameters FROM points_rule_versions WHERE ${SEED_ROW}`);
        const seeded = new Map(seededRows.map((r) => [r.rule_id, r]));
        expect(seeded.size).toBe(POINTS_ENGINE_SEED.length);
        for (const seed of POINTS_ENGINE_SEED) {
          expect(seeded.get(seed.ruleId)?.parameters, seed.ruleId).toEqual(seed.body);
        }
        // max + 1: over the e2e version 2, over a 0059 version 1, from none.
        expect(seeded.get("accrual.lesson")?.version).toBe(3);
        expect(seeded.get("accrual.profile")?.version).toBe(2);
        expect(seeded.get("accrual.lesson.any-mode")?.version).toBe(1);
        expect(seeded.get("setting.effect.maxAmount")?.version).toBe(1);
        // The closing NOTICE names the id whose non-migration version the
        // seed supersedes, and only that one.
        const notices: string[] = [];
        const onNotice = (n: { message?: string }) => notices.push(n.message ?? "");
        client.on("notice", onNotice);
        await client.query(migrationBlock("notice"));
        client.off("notice", onNotice);
        expect(notices).toEqual([
          "0060_points_engine: accrual.lesson seeded as version 3, superseding non-seed version(s) 2",
        ]);
        // Every pre-existing row is unchanged.
        const { rows: after } = await client.query(
          `${listAll} WHERE NOT (${SEED_ROW}) ORDER BY rule_id, version`,
        );
        expect(after).toEqual(before);
        // The seed supersedes the e2e version 2 now and before it.
        for (const at of ["2000-01-01T00:00:00Z", new Date().toISOString()]) {
          const { rows: active } = await client.query<{ version: number }>(
            `SELECT version FROM points_rule_versions
              WHERE rule_id = 'accrual.lesson' AND effective_from <= $1
              ORDER BY version DESC LIMIT 1`,
            [at],
          );
          expect(active[0]?.version, at).toBe(3);
        }
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);
