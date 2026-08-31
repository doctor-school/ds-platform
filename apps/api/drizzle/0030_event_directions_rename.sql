-- ── ADR-0016 §5 / #1645: `event_topics` → `event_directions`, the last leg ───
--
-- #1483 (migration 0026) renamed the `topics` book to `directions` but left the
-- already-shipped 012 EARS-11 join speaking the old noun: the table was still
-- `event_topics`, its column still `topic_id`, and its public traversal still
-- answered `…/topics`. ADR-0016 §5 mandates ONE vocabulary on the shipped
-- surface, so this migration completes the rename.
--
-- This is a TRUE RENAME, hand-written over the drizzle-kit diff exactly as 0026
-- was: the generator offers only DROP + CREATE for a renamed table, which would
-- destroy every retained row and re-issue new ids for classifications the audit
-- ledger (feature-010) already cites. The retained-row lifecycle (#1278) is the
-- whole point of this join — a retired link is RESTORED, never re-inserted — so
-- the row, its id, its version and its audit lineage all survive untouched and
-- only the NAMES move.
--
-- Postgres does not cascade a table rename into its constraints, indexes or
-- triggers, so every dependent object is renamed by hand below; a bare
-- `ALTER TABLE … RENAME` would leave `event_topics_pair_key` guarding a table
-- called `event_directions`, and the next drizzle diff would "fix" that by
-- dropping and re-creating it.
ALTER TABLE "event_topics" RENAME TO "event_directions";--> statement-breakpoint
-- The column the join is named for. Renaming the `topics` table (0026) did not
-- rename the columns pointing at it; this one is renamed on its own here.
ALTER TABLE "event_directions" RENAME COLUMN "topic_id" TO "direction_id";--> statement-breakpoint
ALTER TABLE "event_directions" RENAME CONSTRAINT "event_topics_pkey" TO "event_directions_pkey";--> statement-breakpoint
ALTER TABLE "event_directions" RENAME CONSTRAINT "event_topics_event_id_events_id_fk" TO "event_directions_event_id_events_id_fk";--> statement-breakpoint
-- 0026 already moved this constraint's REFERENCED half into its name
-- (`…_topic_id_directions_id_fk`); the referencing half moves now.
ALTER TABLE "event_directions" RENAME CONSTRAINT "event_topics_topic_id_directions_id_fk" TO "event_directions_direction_id_directions_id_fk";--> statement-breakpoint
ALTER TABLE "event_directions" RENAME CONSTRAINT "event_topics_retired_iff_deleted" TO "event_directions_retired_iff_deleted";--> statement-breakpoint
ALTER TABLE "event_directions" RENAME CONSTRAINT "event_topics_version_positive" TO "event_directions_version_positive";--> statement-breakpoint
-- The pair key spans ACTIVE AND RETAINED rows (012-design §2.1) and is what
-- makes restore-never-reinsert a constraint rather than service etiquette; it is
-- renamed, never re-created, so the guarantee is never off for a moment.
ALTER INDEX "event_topics_pair_key" RENAME TO "event_directions_pair_key";--> statement-breakpoint
ALTER INDEX "event_topics_topic_id_idx" RENAME TO "event_directions_direction_id_idx";--> statement-breakpoint
-- feature-010 audit attachment. `audit_row_change()` is table-agnostic
-- (`TG_TABLE_NAME`), so the table rename above carries the old
-- `event_topics_audit` trigger onto the renamed table and the attachment never
-- lapses. It is re-created here under the new name rather than renamed in
-- place, exactly as 0026 did for `directions_audit`: the EARS-8 audit-coverage
-- guard reads the migration TEXT for an explicit `CREATE TRIGGER` per domain
-- table, so a rename alone would leave `event_directions` looking uncovered.
DROP TRIGGER IF EXISTS "event_topics_audit" ON "event_directions";--> statement-breakpoint
CREATE TRIGGER event_directions_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_directions" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
