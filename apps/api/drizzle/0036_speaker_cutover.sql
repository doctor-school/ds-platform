-- 012 EARS-24 (#1607) — the single cutover release to `event_experts`.
--
-- Owner decision 2026-09-05: one release, one migration. The phased
-- expand/contract machinery of 0032 (a review table, a writer fence on
-- `event_speakers`, a singleton cutover row and its guard) was withdrawn before
-- it ever ran a phase in production, so it is DROPPED rather than advanced —
-- there is no phase to leave and no state to preserve. The 16 legacy speaker
-- rows are re-entered by hand as `experts` + `event_experts` links after this
-- deploy; nothing here migrates data.
--
-- Order matters and is explicit: triggers before the functions they call,
-- functions before the tables they fence, the `event_experts` legacy column
-- (with its composite FK and unique index) before the table it points at, and
-- `event_speakers` last. Every drop names its object, so no statement needs
-- CASCADE and nothing outside this list can be swept away by accident.
--
-- Drizzle-kit produced the `event_experts` / table / enum statements from the
-- schema diff; the trigger and function drops are hand-added, because triggers
-- and plpgsql functions are not part of the Drizzle schema model.

-- 1. Triggers — detach the guards before their functions disappear.
DROP TRIGGER IF EXISTS event_speakers_migration_fence_before_write ON "event_speakers";--> statement-breakpoint
DROP TRIGGER IF EXISTS speaker_migration_cutover_guard_before_write ON "speaker_migration_cutover";--> statement-breakpoint
DROP TRIGGER IF EXISTS speaker_migration_cutover_audit ON "speaker_migration_cutover";--> statement-breakpoint

-- 2. The trigger functions themselves. `audit_row_change()` is the SHARED
--    feature-010 audit function and stays — only the two functions written for
--    the withdrawn design are dropped.
DROP FUNCTION IF EXISTS event_speakers_migration_fence();--> statement-breakpoint
DROP FUNCTION IF EXISTS speaker_migration_cutover_guard();--> statement-breakpoint

-- 3. The withdrawn cutover state: the singleton table (its unique index goes
--    with it) and then the phase enum, which has no other user.
DROP TABLE IF EXISTS "speaker_migration_cutover";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."speaker_migration_phase";--> statement-breakpoint

-- 4. `event_experts` loses the legacy seam: the composite FK first, then the
--    unique index over the column, then the column. After this the link table
--    references `events` and `experts` only.
ALTER TABLE "event_experts" DROP CONSTRAINT IF EXISTS "event_experts_event_legacy_speaker_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "event_experts_legacy_speaker_key";--> statement-breakpoint
ALTER TABLE "event_experts" DROP COLUMN IF EXISTS "legacy_speaker_id";--> statement-breakpoint

-- 5. The free-text list itself. Nothing references it any more (step 4 removed
--    the only inbound FK), so the drop is unqualified — a CASCADE here would
--    hide exactly the kind of forgotten dependency this step must surface.
DROP TABLE "event_speakers";
