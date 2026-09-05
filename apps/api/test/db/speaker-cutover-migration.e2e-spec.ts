import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-24 (Issue #1607) — the CUTOVER release, database layer.
//
// EARS-24 withdrew the migration machinery of `0032_speaker_migration_cutover`
// (no review queue, no cutover-state SSOT, no table trigger) AND the free-text
// speaker design it was built to migrate. One release, one migration: 0036 drops
// every object 0032 created, the `legacy_speaker_id` seam on `event_experts`
// (column, foreign key, unique index) and the free-text speaker table itself.
// `event_experts` is the single source of the speaker projection afterwards; the
// handful of production rows are re-entered by hand after the deploy.
//
// pg.Pool directly, no Nest boot — same pattern as universal-edit-audit.e2e-spec.
// Every assertion is a catalog read, so nothing here writes or needs cleanup.
describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-24 speaker cutover migration (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    async function relationExists(name: string): Promise<boolean> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT to_regclass($1) AS n`,
        [`public.${name}`],
      );
      return rows[0]?.n !== null;
    }

    async function functionExists(name: string): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`,
        [name],
      );
      return rows.length > 0;
    }

    async function triggerExists(name: string): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = $1`,
        [name],
      );
      return rows.length > 0;
    }

    async function typeExists(name: string): Promise<boolean> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT to_regtype($1) AS n`,
        [`public.${name}`],
      );
      return rows[0]?.n !== null;
    }

    async function columnExists(
      table: string,
      column: string,
    ): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [table, column],
      );
      return rows.length > 0;
    }

    async function constraintExists(name: string): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = 'public' AND c.conname = $1`,
        [name],
      );
      return rows.length > 0;
    }

    async function indexExists(name: string): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        [name],
      );
      return rows.length > 0;
    }

    it("012 EARS-24: after the cutover migration no object of the withdrawn design, no event_experts.legacy_speaker_id and no event_speakers table exist", async () => {
      // 1. Every object migration 0032 created is gone.
      expect(await relationExists("speaker_migration_cutover")).toBe(false);
      expect(await typeExists("speaker_migration_phase")).toBe(false);
      for (const fn of [
        "speaker_migration_cutover_guard",
        "event_speakers_migration_fence",
      ]) {
        expect(await functionExists(fn)).toBe(false);
      }
      for (const trg of [
        "speaker_migration_cutover_guard_before_write",
        "speaker_migration_cutover_audit",
        "event_speakers_migration_fence_before_write",
      ]) {
        expect(await triggerExists(trg)).toBe(false);
      }

      // 2. The `legacy_speaker_id` seam on `event_experts` is gone whole —
      //    column, the composite foreign key and the unique index.
      expect(await columnExists("event_experts", "legacy_speaker_id")).toBe(
        false,
      );
      expect(
        await constraintExists("event_experts_event_legacy_speaker_fk"),
      ).toBe(false);
      expect(await indexExists("event_experts_legacy_speaker_key")).toBe(false);

      // 3. The free-text speaker table itself is gone.
      expect(await relationExists("event_speakers")).toBe(false);

      // 4. `event_experts` — the single remaining source — still stands, with
      //    the slot-collision index that is now the only one of its kind.
      expect(await relationExists("event_experts")).toBe(true);
      expect(
        await indexExists("event_experts_event_position_active_uniq"),
      ).toBe(true);

      // 5. The shared feature-010 audit function is NOT collateral damage.
      expect(await functionExists("audit_row_change")).toBe(true);
    });
  },
);
