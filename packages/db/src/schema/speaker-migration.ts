import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Monotonic phase of the 012 legacy-speaker cutover (012-design §2.3).
 *
 * `review_open` — the migration review queue is open; legacy `event_speakers`
 * INSERTs still happen and are enqueued, and an app-only rollback to any
 * pre-expand image is still database-compatible.
 *
 * `source_closed` — the serializable closure transaction proved exact resolved
 * source↔queue coverage, copied the phase-aware expand release SHA/ordinal into
 * the minimum-compatible pair and advanced the phase. From here EVERY write to
 * `event_speakers` is refused at the database boundary, and a pre-expand image
 * is no longer database-compatible.
 *
 * The transition is one-way. A separate type from `record_status` and
 * `taxonomy_status`: this is a deployment-cutover state machine, not a row
 * lifecycle.
 */
export const speakerMigrationPhase = pgEnum("speaker_migration_phase", [
  "review_open",
  "source_closed",
]);

/**
 * `speaker_migration_cutover` — the retained database SSOT of the 012
 * legacy-speaker cutover (012-requirements EARS-24, 012-design §2.3). Exactly
 * ONE row ever exists, seeded by the migration that creates the table.
 *
 * WHY IT IS A DATABASE ROW AND NOT A CONFIG FLAG. Two independent consumers
 * must read the same truth without sharing an application process:
 *
 *   1. the `event_speakers_migration_fence_before_write` trigger, which locks
 *      this row `FOR UPDATE` on every legacy write — including direct DML from
 *      a pre-expand image that knows nothing about the cutover;
 *   2. `pnpm deploy:prod --rollback <sha>`, which reads the minimum-compatible
 *      pair from production BEFORE any provider mutation and refuses a target
 *      release below it (tools/deploy/rollback-floor.mjs, Issue #1633).
 *
 * A file, an env var or an application cache would let one of those two act on
 * a stale phase; a locked row cannot.
 *
 * THE TWO RELEASE PAIRS.
 *   * `phase_aware_release_*` — the immutable production release SHA and its
 *     authoritative ordinal recorded BY the expand deployment, i.e. the first
 *     image that understands `source_closed`.
 *   * `minimum_compatible_release_*` — the enforceable rollback floor. The
 *     closure transaction copies the phase-aware pair here in the SAME
 *     serializable transaction that advances the phase, so no `source_closed`
 *     state can exist without a floor (design §2.3 stage 2).
 *
 * The ordinal is the release's rank in the chronological `release-YYYY.MM.DD-<n>`
 * tag sequence (tools/release/cut-release.mjs) — the per-day `<n>` in the tag is
 * not globally monotonic, so the rank is what "ordinal" means everywhere in this
 * feature. It is stored ALONGSIDE the SHA precisely so the deploy guard can
 * cross-check the two and fail closed when they disagree.
 *
 * Retained: the row is never deleted and the table is never dropped, not even by
 * the contract deployment (design §2.3 stage 3). Physical deletion is refused by
 * `speaker_migration_cutover_immutable_before_write` in the same migration.
 */
export const speakerMigrationCutover = pgTable(
  "speaker_migration_cutover",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * Singleton pin. `true` for the one row, `CHECK (singleton)` forbids any
     * other value and the unique index forbids a second `true` — together they
     * make "exactly one row" a constraint rather than a convention, so a
     * second cutover row cannot be inserted by a script, a fixture or a bad
     * merge.
     */
    singleton: boolean("singleton").notNull().default(true),
    phase: speakerMigrationPhase("phase").notNull().default("review_open"),
    /** Optimistic-concurrency counter; bumped by the immutability trigger on every UPDATE. */
    version: integer("version").notNull().default(1),
    /** Full 40-hex commit SHA of the expand release (NULL until the expand deployment records it). */
    phaseAwareReleaseSha: text("phase_aware_release_sha"),
    /** Authoritative release ordinal of `phase_aware_release_sha`. */
    phaseAwareReleaseOrdinal: integer("phase_aware_release_ordinal"),
    /** Rollback floor SHA — NULL until source closure copies the phase-aware pair here. */
    minimumCompatibleReleaseSha: text("minimum_compatible_release_sha"),
    /** Rollback floor ordinal — moves only together with the SHA above. */
    minimumCompatibleReleaseOrdinal: integer("minimum_compatible_release_ordinal"),
    /** When the phase last advanced (NULL while still `review_open`). */
    phaseAdvancedAt: timestamp("phase_advanced_at", { withTimezone: true }),
    /**
     * 012 EARS-24 (#1607) — when the owner-reviewed source list was imported,
     * i.e. when the review queue actually OPENED. `review_open` is the phase a
     * fresh database is seeded in, so the phase alone cannot say whether the
     * queue exists yet; this timestamp can, and it is what the enqueue trigger
     * gates on. Before the import a legacy `event_speakers` INSERT is an
     * ordinary authoring write with no queue to join; from the import onward
     * every INSERT is enqueued in its own transaction, which is what makes the
     * closure transaction's exact source↔queue coverage provable.
     *
     * Written exactly once, by the import command, inside the same transaction
     * that writes the reviewed rows.
     */
    sourceImportCompletedAt: timestamp("source_import_completed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("speaker_migration_cutover_singleton_uniq").on(t.singleton),
    check("speaker_migration_cutover_singleton_true", sql`${t.singleton}`),
    check("speaker_migration_cutover_version_positive", sql`${t.version} >= 1`),
    // Each release pair moves as a unit — a half-written pair is the corruption
    // the deploy guard fails closed on, so the database refuses to produce it.
    check(
      "speaker_migration_cutover_phase_aware_pair",
      sql`(${t.phaseAwareReleaseSha} IS NULL) = (${t.phaseAwareReleaseOrdinal} IS NULL)`,
    ),
    check(
      "speaker_migration_cutover_minimum_compatible_pair",
      sql`(${t.minimumCompatibleReleaseSha} IS NULL) = (${t.minimumCompatibleReleaseOrdinal} IS NULL)`,
    ),
    // `source_closed` with no enforceable floor is exactly the state design
    // §2.3 forbids ("no source_closed state exists without an enforceable
    // rollback floor"), and the state that would make the deploy guard
    // unreadable. It is unrepresentable, not merely avoided by the service.
    check(
      "speaker_migration_cutover_closed_requires_floor",
      sql`${t.phase} <> 'source_closed' OR (${t.minimumCompatibleReleaseSha} IS NOT NULL AND ${t.phaseAdvancedAt} IS NOT NULL AND ${t.sourceImportCompletedAt} IS NOT NULL)`,
    ),
    check(
      "speaker_migration_cutover_sha_shape",
      sql`(${t.phaseAwareReleaseSha} IS NULL OR ${t.phaseAwareReleaseSha} ~ '^[0-9a-f]{40}$')
          AND (${t.minimumCompatibleReleaseSha} IS NULL OR ${t.minimumCompatibleReleaseSha} ~ '^[0-9a-f]{40}$')`,
    ),
    check(
      "speaker_migration_cutover_ordinals_positive",
      sql`(${t.phaseAwareReleaseOrdinal} IS NULL OR ${t.phaseAwareReleaseOrdinal} >= 1)
          AND (${t.minimumCompatibleReleaseOrdinal} IS NULL OR ${t.minimumCompatibleReleaseOrdinal} >= 1)`,
    ),
  ],
);

export type SpeakerMigrationCutover = typeof speakerMigrationCutover.$inferSelect;
export type NewSpeakerMigrationCutover = typeof speakerMigrationCutover.$inferInsert;
