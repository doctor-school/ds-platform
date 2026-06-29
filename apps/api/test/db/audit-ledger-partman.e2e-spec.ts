import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// EARS-18 hardening (#136, ADR-0003 §3/§6): the natively RANGE-partitioned
// auth-audit ledger (migration 0003) is registered with pg_partman 5.4.3 for
// monthly partition AUTO-CREATION. The migration configures the partman
// background worker (`shared_preload_libraries='pg_partman_bgw'`) to drive
// maintenance in production/dev — but the BGW itself is config-verified, NOT
// exercised here: the CI api-e2e container does not load the BGW library, so
// these specs exercise the building blocks the BGW would call
// (`create_partition_time` / `run_maintenance`), not the worker loop.
// This is the v1 slice — partition auto-creation ONLY. The retention DROP +
// crypto-shred is split out to #383 and stays DISABLED here (ADR-0003 §3: the
// drop-mask is enabled at the first confirmed retention scenario), so the
// `part_config.retention` invariant below is "must be NULL".
//
// These assertions talk to Postgres directly via a `pg.Pool` (no Nest boot) and
// prove: the parent is registered in `partman.part_config` with the expected
// control/interval/premake and automatic_maintenance on; retention is OFF; the
// pre-created 2026-2027 manual buffer + `audit_ledger_default` are preserved
// (not duplicated); pg_partman creates monthly partitions BEYOND the buffer and
// the operation is idempotent; and the append-only trigger still cascades.
//
// Gated on DATABASE_URL exactly like the partitioning e2e — runs in the
// `api-e2e` CI job (Postgres built from the partman image) and is skipped in
// the unit job.
describe.skipIf(!process.env.DATABASE_URL)(
  "audit_ledger pg_partman auto-creation (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    // Far-future partition EARS-18.9 force-creates. Named here so the cleanup
    // and the test agree on exactly one island partition.
    const islandPartition = "audit_ledger_p20310901";

    afterAll(async () => {
      // Shared-stand hygiene: EARS-18.9 force-creates a far-future island
      // partition (years past the live edge) to prove auto-creation works. It
      // holds no live data, so drop it rather than leak a stray child onto the
      // shared ds_dev volume. IF EXISTS so the cleanup is a no-op when the test
      // is skipped, and it also reclaims any island leaked by a prior run.
      await pool.query(`DROP TABLE IF EXISTS ${islandPartition}`);
      await pool.end();
    });

    /** Names of every pg_partman-created child (its `_pYYYYMMDD` convention). */
    async function partmanPartitions(): Promise<string[]> {
      const { rows } = await pool.query<{ child: string }>(
        `SELECT inhrelid::regclass::text AS child
         FROM pg_inherits
         WHERE inhparent = 'public.audit_ledger'::regclass
           AND inhrelid::regclass::text LIKE 'audit_ledger_p20%'
         ORDER BY child`,
      );
      return rows.map((r) => r.child);
    }

    it("EARS-18.6: audit_ledger is registered in partman.part_config with monthly RANGE control + automatic maintenance", async () => {
      const { rows } = await pool.query<{
        control: string;
        partition_interval: string;
        partition_type: string;
        premake: number;
        automatic_maintenance: string;
      }>(
        `SELECT control,
                partition_interval::text AS partition_interval,
                partition_type,
                premake,
                automatic_maintenance
         FROM partman.part_config
         WHERE parent_table = 'public.audit_ledger'`,
      );
      expect(rows).toHaveLength(1);
      const cfg = rows[0]!;
      expect(cfg.control).toBe("created_at");
      // pg_partman normalises '1 month' to the interval '1 mon'.
      expect(cfg.partition_interval).toBe("1 mon");
      expect(cfg.partition_type).toBe("range");
      // ADR-0003 §3 — keep ~2-3 months ahead of the live edge.
      expect(cfg.premake).toBe(3);
      expect(cfg.automatic_maintenance).toBe("on");
    });

    it("EARS-18.7: retention is OFF — the v1 drop-mask is disabled (deferred to #383)", async () => {
      const { rows } = await pool.query<{ retention: string | null }>(
        `SELECT retention
         FROM partman.part_config
         WHERE parent_table = 'public.audit_ledger'`,
      );
      expect(rows).toHaveLength(1);
      // Retention unset ⇒ pg_partman never DROPs a partition. The 5y crypto-shred
      // retention scenario is #383, intentionally not configured on v1.
      expect(rows[0]!.retention).toBeNull();
    });

    it("EARS-18.8: the pre-created 2026-2027 buffer and audit_ledger_default are preserved (adopted, not duplicated)", async () => {
      // The 24 manual monthly partitions (audit_ledger_yYYYY_mMM) from 0003 must
      // survive registration — pg_partman's chain starts AFTER them, so it never
      // overlaps or recreates them.
      const { rows: manual } = await pool.query<{ child: string }>(
        `SELECT inhrelid::regclass::text AS child
         FROM pg_inherits
         WHERE inhparent = 'public.audit_ledger'::regclass
           AND inhrelid::regclass::text LIKE 'audit_ledger_y20%'`,
      );
      expect(manual).toHaveLength(24);

      const { rows: dflt } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_inherits
           WHERE inhparent = 'public.audit_ledger'::regclass
             AND inhrelid = 'audit_ledger_default'::regclass
         ) AS exists`,
      );
      expect(dflt[0]!.exists).toBe(true);
    });

    it("EARS-18.9: pg_partman creates a monthly partition BEYOND the fixed buffer, idempotently", async () => {
      // A month far past the manual 2026-2027 buffer. create_partition_time is
      // the exact routine run_maintenance (and the BGW, in dev/prod) drives to
      // extend the chain; calling it directly proves auto-creation works without
      // mutating the shared-stand premake horizon or depending on the wall clock.
      // The island it creates is dropped in afterAll (shared-stand hygiene).
      const beyondBuffer = "2031-09-01 00:00:00+00";
      const expected = islandPartition;

      await pool.query(
        `SELECT partman.create_partition_time('public.audit_ledger', ARRAY[$1::timestamptz])`,
        [beyondBuffer],
      );
      const after = await partmanPartitions();
      expect(after).toContain(expected);

      // Re-running is a no-op — pg_partman does not duplicate an existing child.
      await pool.query(
        `SELECT partman.create_partition_time('public.audit_ledger', ARRAY[$1::timestamptz])`,
        [beyondBuffer],
      );
      const again = await partmanPartitions();
      expect(again.filter((p) => p === expected)).toHaveLength(1);
      expect(again).toEqual(after);
    });

    it("EARS-18.10: run_maintenance executes and is idempotent (no error, no drift)", async () => {
      // At the current clock the premake horizon sits behind the manual buffer,
      // so maintenance is a safe no-op here — but it must run cleanly and not
      // disturb the partition set. In dev/prod the BGW invokes run_maintenance
      // on its interval (config-verified via postgresql.conf, not loaded in CI).
      const before = await partmanPartitions();
      await pool.query(
        `SELECT partman.run_maintenance(p_parent_table := 'public.audit_ledger')`,
      );
      await pool.query(
        `SELECT partman.run_maintenance(p_parent_table := 'public.audit_ledger')`,
      );
      const after = await partmanPartitions();
      expect(after).toEqual(before);
    });

    it("EARS-18.11: the append-only trigger still blocks UPDATE/DELETE after partman registration", async () => {
      // Insert into a manual buffer month, then prove the BEFORE ROW trigger on
      // the partitioned parent still fires for a child-partition row.
      const eventId = randomUUID();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO audit_ledger (event_id, event_type, created_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [eventId, "auth.test.partman", "2026-09-09T00:00:00Z"],
      );
      const id = rows[0]!.id;
      await expect(
        pool.query("UPDATE audit_ledger SET reason = 'x' WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        pool.query("DELETE FROM audit_ledger WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/i);
    });
  },
);
