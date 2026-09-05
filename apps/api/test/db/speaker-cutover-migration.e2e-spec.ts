import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-24 (Issue #1607) — the CUTOVER release, database layer.
//
// EARS-24 withdrew the migration machinery of `0032_speaker_migration_cutover`:
// no review queue, no cutover-state SSOT, no table trigger. Migration 0036 drops
// every object 0032 created. None of them ever reached production, so this
// release is app-only reversible — which is exactly why it must ALSO leave
// `event_speakers` and `event_experts.legacy_speaker_id` standing: the image
// running in production still reads them. Dropping those is the deliberate
// point of no return of the LATER contract release.
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

    it("012 EARS-24: after the cutover migration the 0032 objects are gone while event_speakers and event_experts.legacy_speaker_id remain", async () => {
      // 1. Every object migration 0032 created is gone.
      expect(await relationExists("speaker_migration_reviews")).toBe(false);
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

      // 2. The rollback surface the running production image reads is UNTOUCHED
      //    — the contract release, not this one, drops these.
      expect(await relationExists("event_speakers")).toBe(true);
      expect(await columnExists("event_experts", "legacy_speaker_id")).toBe(
        true,
      );
    });
  },
);
