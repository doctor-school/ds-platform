import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// EARS-18 hardening (#136, ADR-0003 §2.7/§6): the auth-audit ledger is converted
// to native declarative RANGE partitioning on `created_at` (monthly partitions),
// closing the partitioning portion of decision-debt #136. These assertions talk
// to Postgres directly via a `pg.Pool` (no Nest boot needed) and prove the
// physical shape: the parent is partitioned, rows route to the month partition,
// out-of-range rows fall to the DEFAULT safety net, the composite `event_id`
// unique still dedups within a partition, and the append-only trigger still
// cascades to child partitions.
//
// Gated on DATABASE_URL exactly like the auth audit-ledger e2e — runs in the
// `api-e2e` CI job with a real Postgres, skipped in the unit job.
describe.skipIf(!process.env.DATABASE_URL)(
  "audit_ledger native RANGE partitioning (e2e)",
  () => {
    let pool: pg.Pool;
    // Every row this suite inserts carries a unique event_id so cleanup and
    // assertions never collide with prior-run rows (the ledger is append-only —
    // DELETE is trigger-blocked, so we cannot tidy up after ourselves; we simply
    // scope every read to the ids we wrote).
    const writtenEventIds: string[] = [];

    /** Insert a ledger row with an explicit created_at; returns the new id. */
    async function insertAt(
      eventId: string,
      createdAt: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO audit_ledger (event_id, event_type, created_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [eventId, "auth.test.partitioning", createdAt],
      );
      writtenEventIds.push(eventId);
      return rows[0]!.id;
    }

    /** The partition (child table) a given row physically lives in. */
    async function partitionOf(id: string): Promise<string> {
      const { rows } = await pool.query<{ partition: string }>(
        `SELECT tableoid::regclass::text AS partition
         FROM audit_ledger WHERE id = $1`,
        [id],
      );
      return rows[0]!.partition;
    }

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    it("EARS-18.1: audit_ledger is a table partitioned by RANGE on created_at", async () => {
      // relkind 'p' == partitioned table; partstrat 'r' == RANGE. partattrs is a
      // 0-indexed int2vector, so partattrs[0] is the (sole) partition-key attnum.
      const { rows } = await pool.query<{
        relkind: string;
        partstrat: string;
        keycol: string;
      }>(
        `SELECT c.relkind,
                p.partstrat,
                a.attname AS keycol
         FROM pg_class c
         JOIN pg_partitioned_table p ON p.partrelid = c.oid
         JOIN pg_attribute a
           ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]
         WHERE c.relname = 'audit_ledger'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.relkind).toBe("p");
      expect(rows[0]!.partstrat).toBe("r");
      expect(rows[0]!.keycol).toBe("created_at");
    });

    it("EARS-18.2: a row lands in its month's partition (audit_ledger_yYYYY_mMM)", async () => {
      const id = await insertAt(randomUUID(), "2026-06-15T12:00:00Z");
      expect(await partitionOf(id)).toBe("audit_ledger_y2026_m06");
    });

    it("EARS-18.3: a row outside the pre-created range falls to audit_ledger_default", async () => {
      // 2099 is far beyond the fixed 2026-01..2027-12 buffer — the DEFAULT
      // partition is the never-lose-an-audit-write safety net.
      const id = await insertAt(randomUUID(), "2099-01-01T00:00:00Z");
      expect(await partitionOf(id)).toBe("audit_ledger_default");
    });

    it("EARS-18.4: an idempotent re-ingest (same event_id + created_at, one partition) is rejected by the composite unique", async () => {
      // The composite unique is (event_id, created_at): the partition key MUST
      // be part of every unique constraint on a partitioned table. So the dedup
      // guarantee is "no two rows share the SAME event_id AND created_at" — which
      // is exactly an idempotent replay carrying the original event timestamp.
      // A second insert with the identical (event_id, created_at) is rejected.
      const eventId = randomUUID();
      const at = "2026-07-10T00:00:00Z";
      await insertAt(eventId, at);
      await expect(insertAt(eventId, at)).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });

    it("EARS-18.5: UPDATE/DELETE on a child-partition row is blocked by the append-only trigger", async () => {
      const id = await insertAt(randomUUID(), "2026-08-05T00:00:00Z");
      // The row physically lives in a child partition; the BEFORE ROW trigger on
      // the partitioned parent must still fire for mutations that target it.
      await expect(
        pool.query("UPDATE audit_ledger SET reason = 'x' WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        pool.query("DELETE FROM audit_ledger WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/i);
    });
  },
);
