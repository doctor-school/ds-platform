import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-24 (Issue #1633) — the speaker-cutover SSOT and the `event_speakers`
// writer fence (migration 0032, `012-design.md` §2.3).
//
// This suite exercises the DATABASE layer only: the two BEFORE-write triggers
// installed by 0032 and the CHECK constraints on the retained singleton. No
// Nest boot — pg.Pool directly, same pattern as universal-edit-audit.e2e-spec.
//
// PHASE MONOTONICITY IS THE REASON EVERY CASE RUNS IN A ROLLBACK.
// `source_closed` is a one-way door enforced by the guard trigger, and this
// suite runs against a SHARED branch database. So no test commits: each opens a
// transaction, advances the phase and/or writes, asserts, and ROLLBACKs. That
// also means no fixture cleanup exists (or is possible) here — the fence itself
// refuses `DELETE FROM event_speakers` in every phase.
//
// Out of scope, deferred WITH `speaker_migration_reviews` to #1607:
// `event_speakers_enqueue_review_after_insert` and the `review_open` clause
// "UPDATE refused once the source row has a retained review". Both address rows
// in a table this migration does not create.

/** A syntactically valid release SHA (the singleton's CHECK is `^[0-9a-f]{40}$`). */
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-24 speaker-migration cutover — SSOT + event_speakers fence (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    /**
     * Run `fn` inside a transaction that is ALWAYS rolled back. Returns whatever
     * `fn` returns; a rejection propagates after the rollback.
     */
    async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        return await fn(client);
      } finally {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }

    /**
     * Open the review queue for the current transaction — the same fact the
     * import command commits (`source_import_completed_at`), which is what arms
     * the enqueue trigger. Before it, `review_open` is simply "the migration has
     * not started", so authoring is untouched.
     */
    async function openQueue(client: pg.PoolClient): Promise<void> {
      await client.query(
        `UPDATE speaker_migration_cutover SET source_import_completed_at = now()`,
      );
    }

    /** Insert a throwaway event; returns its id. */
    async function insertEvent(client: pg.PoolClient): Promise<string> {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
         VALUES ($1, $2, 'fence-e2e', now() + interval '1 day', 60)
         RETURNING id`,
        [`fence-e2e-${randomUUID()}`, "fence e2e event"],
      );
      return rows[0]!.id;
    }

    /** Insert a legacy speaker row (only legal while the phase is `review_open`). */
    async function insertSpeaker(client: pg.PoolClient, eventId: string): Promise<string> {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO event_speakers (event_id, position, name, regalia)
         VALUES ($1, 0, 'Legacy Speaker', 'MD') RETURNING id`,
        [eventId],
      );
      return rows[0]!.id;
    }

    /** Advance the singleton to `source_closed` with a coherent rollback floor. */
    async function closeSource(client: pg.PoolClient): Promise<void> {
      await client.query(
        `UPDATE speaker_migration_cutover
            SET phase = 'source_closed',
                minimum_compatible_release_sha = $1,
                minimum_compatible_release_ordinal = 7,
                phase_advanced_at = now()`,
        [SHA_A],
      );
    }

    /**
     * Seed an event + speaker under `review_open`, close the source, then run the
     * write that must be refused. One assertion per transaction: the first failed
     * statement aborts the transaction anyway.
     */
    async function expectClosedFenceRefusal(
      write: (c: pg.PoolClient, ctx: { eventId: string; speakerId: string }) => Promise<unknown>,
    ): Promise<void> {
      await expect(
        inRollback(async (client) => {
          const eventId = await insertEvent(client);
          const speakerId = await insertSpeaker(client, eventId);
          await closeSource(client);
          return write(client, { eventId, speakerId });
        }),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);
    }

    // ── The singleton exists and is the shipped default ────────────────────

    it("012 EARS-24.1: the cutover SSOT is a seeded singleton that starts in review_open", async () => {
      const { rows } = await pool.query<{
        count: string;
        phase: string;
        minimum_compatible_release_sha: string | null;
      }>(
        `SELECT count(*)::text AS count,
                min(phase::text) AS phase,
                min(minimum_compatible_release_sha) AS minimum_compatible_release_sha
           FROM speaker_migration_cutover`,
      );
      expect(rows[0]!.count).toBe("1");
      expect(rows[0]!.phase).toBe("review_open");
      // A freshly migrated database records no floor: nothing has been closed yet.
      expect(rows[0]!.minimum_compatible_release_sha).toBeNull();
    });

    it("012 EARS-24.2: both 0032 triggers are attached to their tables", async () => {
      const { rows } = await pool.query<{ tgname: string; relname: string }>(
        `SELECT t.tgname, c.relname
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal
            AND t.tgname IN ('event_speakers_migration_fence_before_write',
                             'speaker_migration_cutover_guard_before_write',
                             'speaker_migration_cutover_audit')`,
      );
      const byName = new Map(rows.map((r) => [r.tgname, r.relname]));
      expect(byName.get("event_speakers_migration_fence_before_write")).toBe("event_speakers");
      expect(byName.get("speaker_migration_cutover_guard_before_write")).toBe(
        "speaker_migration_cutover",
      );
      // The 010 EARS-8 capture trigger: the SSOT is domain truth, so it is audited.
      expect(byName.get("speaker_migration_cutover_audit")).toBe("speaker_migration_cutover");
    });

    // ── source_closed: EVERY write against event_speakers is refused ───────
    // The six rows of the Scenario Outline in 012-scenarios.feature (@EARS-24).

    it("012 EARS-24.3: source_closed refuses INSERT on event_speakers", async () => {
      await expectClosedFenceRefusal((client, { eventId }) =>
        client.query(
          `INSERT INTO event_speakers (event_id, position, name) VALUES ($1, 1, 'Late Arrival')`,
          [eventId],
        ),
      );
    });

    it("012 EARS-24.4: source_closed refuses a content UPDATE on event_speakers", async () => {
      await expectClosedFenceRefusal((client, { speakerId }) =>
        client.query(`UPDATE event_speakers SET name = 'Renamed' WHERE id = $1`, [speakerId]),
      );
    });

    it("012 EARS-24.5: source_closed refuses a retire UPDATE on event_speakers", async () => {
      await expectClosedFenceRefusal((client, { speakerId }) =>
        client.query(
          `UPDATE event_speakers SET record_status = 'retired', deleted_at = now() WHERE id = $1`,
          [speakerId],
        ),
      );
    });

    it("012 EARS-24.6: source_closed refuses a restore UPDATE on event_speakers", async () => {
      await expect(
        inRollback(async (client) => {
          const eventId = await insertEvent(client);
          const speakerId = await insertSpeaker(client, eventId);
          // Retire while the source is still open, so the restore below is the
          // only operation the fence has to refuse.
          await client.query(
            `UPDATE event_speakers SET record_status = 'retired', deleted_at = now() WHERE id = $1`,
            [speakerId],
          );
          await closeSource(client);
          return client.query(
            `UPDATE event_speakers SET record_status = 'active', deleted_at = NULL WHERE id = $1`,
            [speakerId],
          );
        }),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);
    });

    it("012 EARS-24.7: source_closed refuses a reorder UPDATE on event_speakers", async () => {
      await expectClosedFenceRefusal((client, { speakerId }) =>
        client.query(`UPDATE event_speakers SET position = 5 WHERE id = $1`, [speakerId]),
      );
    });

    it("012 EARS-24.8: source_closed refuses DELETE on event_speakers", async () => {
      await expectClosedFenceRefusal((client, { speakerId }) =>
        client.query(`DELETE FROM event_speakers WHERE id = $1`, [speakerId]),
      );
    });

    // ── review_open: writes flow, but the source set is never thinned ──────

    /**
     * REWORKED by #1607. 0032's own header deferred the review queue to this
     * Issue, and the queue changes what `review_open` admits: migration 0036
     * enqueues an `unmatched` review for every INSERT, and the fence's
     * `review_open` clause then refuses UPDATE on a source row that has one.
     * So `review_open` is «INSERT flows, and the inserted row is immediately
     * provenance» — not «INSERT and UPDATE both flow». Free-text correction is
     * retired from the expand release onward; a wrong name is fixed by
     * resolving the review onto an Expert, never by rewriting the archive.
     */
    it("012 EARS-24.9: before the import the queue does not exist and authoring is unaffected", async () => {
      const [queued, updated] = await inRollback(async (client) => {
        const eventId = await insertEvent(client);
        const speakerId = await insertSpeaker(client, eventId);
        const { rowCount } = await client.query(
          `SELECT 1 FROM speaker_migration_reviews WHERE source_speaker_id = $1`,
          [speakerId],
        );
        const write = await client.query(
          `UPDATE event_speakers SET name = 'Corrected Name' WHERE id = $1`,
          [speakerId],
        );
        return [rowCount, write.rowCount];
      });
      expect(queued).toBe(0);
      expect(updated).toBe(1);
    });

    it("012 EARS-24.9.1: from the import onward review_open admits INSERT, enqueues it, and then refuses UPDATE", async () => {
      const queued = await inRollback(async (client) => {
        await openQueue(client);
        const eventId = await insertEvent(client);
        const speakerId = await insertSpeaker(client, eventId);
        const { rows } = await client.query<{
          original_classification: string;
          disposition: string;
        }>(
          `SELECT original_classification, disposition
             FROM speaker_migration_reviews
            WHERE source_speaker_id = $1`,
          [speakerId],
        );
        return rows;
      });
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        original_classification: "unmatched",
        disposition: "unresolved",
      });

      await expect(
        inRollback(async (client) => {
          await openQueue(client);
          const eventId = await insertEvent(client);
          const speakerId = await insertSpeaker(client, eventId);
          return client.query(
            `UPDATE event_speakers SET name = 'Corrected Name' WHERE id = $1`,
            [speakerId],
          );
        }),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);
    });

    it("012 EARS-24.10: review_open still refuses DELETE — source rows are retained provenance", async () => {
      await expect(
        inRollback(async (client) => {
          const eventId = await insertEvent(client);
          const speakerId = await insertSpeaker(client, eventId);
          return client.query(`DELETE FROM event_speakers WHERE id = $1`, [speakerId]);
        }),
      ).rejects.toThrow(/retained provenance; DELETE refused/);
    });

    // ── The SSOT row itself: retained, singleton, monotonic ────────────────

    it("012 EARS-24.11: the cutover row cannot be deleted", async () => {
      await expect(
        inRollback((client) => client.query(`DELETE FROM speaker_migration_cutover`)),
      ).rejects.toThrow(/retained/);
    });

    it("012 EARS-24.12: a second cutover row is refused", async () => {
      await expect(
        inRollback((client) =>
          client.query(`INSERT INTO speaker_migration_cutover (singleton) VALUES (true)`),
        ),
      ).rejects.toThrow(/singleton/);
    });

    it("012 EARS-24.13: source_closed never returns to review_open", async () => {
      await expect(
        inRollback(async (client) => {
          await closeSource(client);
          return client.query(
            `UPDATE speaker_migration_cutover SET phase = 'review_open'`,
          );
        }),
      ).rejects.toThrow(/monotonic/);
    });

    it("012 EARS-24.14: the rollback floor ordinal only ever rises", async () => {
      await expect(
        inRollback(async (client) => {
          await closeSource(client); // floor ordinal = 7
          return client.query(
            `UPDATE speaker_migration_cutover
                SET minimum_compatible_release_sha = $1,
                    minimum_compatible_release_ordinal = 6`,
            [SHA_B],
          );
        }),
      ).rejects.toThrow(/rollback floor and only rises/);
    });

    it("012 EARS-24.15: the rollback floor cannot be cleared once recorded", async () => {
      await expect(
        inRollback(async (client) => {
          await closeSource(client);
          return client.query(
            `UPDATE speaker_migration_cutover
                SET minimum_compatible_release_sha = NULL,
                    minimum_compatible_release_ordinal = NULL`,
          );
        }),
      ).rejects.toThrow(/rollback floor and only rises/);
    });

    it("012 EARS-24.16: a half-written release pair is unrepresentable", async () => {
      await expect(
        inRollback((client) =>
          client.query(
            `UPDATE speaker_migration_cutover SET minimum_compatible_release_sha = $1`,
            [SHA_A],
          ),
        ),
      ).rejects.toThrow(/minimum_compatible_pair/);
    });

    it("012 EARS-24.17: a release SHA that is not a 40-hex commit id is refused", async () => {
      await expect(
        inRollback((client) =>
          client.query(
            `UPDATE speaker_migration_cutover
                SET phase_aware_release_sha = 'not-a-sha', phase_aware_release_ordinal = 1`,
          ),
        ),
      ).rejects.toThrow(/sha_shape/);
    });

    it("012 EARS-24.18: source_closed without a rollback floor is refused", async () => {
      await expect(
        inRollback((client) =>
          client.query(
            `UPDATE speaker_migration_cutover SET phase = 'source_closed', phase_advanced_at = now()`,
          ),
        ),
      ).rejects.toThrow(/closed_requires_floor/);
    });

    it("012 EARS-24.19: the database maintains version and updated_at on every accepted change", async () => {
      const result = await inRollback(async (client) => {
        const before = await client.query<{ version: number; id: string; created_at: Date }>(
          `SELECT version, id, created_at FROM speaker_migration_cutover`,
        );
        // A caller that forgets `version` (and even one that tries to freeze it)
        // cannot produce a stale-looking row.
        await client.query(
          `UPDATE speaker_migration_cutover
              SET phase_aware_release_sha = $1, phase_aware_release_ordinal = 3, version = 1`,
          [SHA_B],
        );
        const after = await client.query<{ version: number; id: string; created_at: Date }>(
          `SELECT version, id, created_at FROM speaker_migration_cutover`,
        );
        return { before: before.rows[0]!, after: after.rows[0]! };
      });
      expect(result.after.version).toBe(result.before.version + 1);
      // Identity and birth time are immutable regardless of what the caller sent.
      expect(result.after.id).toBe(result.before.id);
      expect(result.after.created_at.getTime()).toBe(result.before.created_at.getTime());
    });
  },
);
