CREATE TYPE "public"."speaker_migration_phase" AS ENUM('review_open', 'source_closed');--> statement-breakpoint
CREATE TABLE "speaker_migration_cutover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"phase" "speaker_migration_phase" DEFAULT 'review_open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"phase_aware_release_sha" text,
	"phase_aware_release_ordinal" integer,
	"minimum_compatible_release_sha" text,
	"minimum_compatible_release_ordinal" integer,
	"phase_advanced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaker_migration_cutover_singleton_true" CHECK ("speaker_migration_cutover"."singleton"),
	CONSTRAINT "speaker_migration_cutover_version_positive" CHECK ("speaker_migration_cutover"."version" >= 1),
	CONSTRAINT "speaker_migration_cutover_phase_aware_pair" CHECK (("speaker_migration_cutover"."phase_aware_release_sha" IS NULL) = ("speaker_migration_cutover"."phase_aware_release_ordinal" IS NULL)),
	CONSTRAINT "speaker_migration_cutover_minimum_compatible_pair" CHECK (("speaker_migration_cutover"."minimum_compatible_release_sha" IS NULL) = ("speaker_migration_cutover"."minimum_compatible_release_ordinal" IS NULL)),
	CONSTRAINT "speaker_migration_cutover_closed_requires_floor" CHECK ("speaker_migration_cutover"."phase" <> 'source_closed' OR ("speaker_migration_cutover"."minimum_compatible_release_sha" IS NOT NULL AND "speaker_migration_cutover"."phase_advanced_at" IS NOT NULL)),
	CONSTRAINT "speaker_migration_cutover_sha_shape" CHECK (("speaker_migration_cutover"."phase_aware_release_sha" IS NULL OR "speaker_migration_cutover"."phase_aware_release_sha" ~ '^[0-9a-f]{40}$')
          AND ("speaker_migration_cutover"."minimum_compatible_release_sha" IS NULL OR "speaker_migration_cutover"."minimum_compatible_release_sha" ~ '^[0-9a-f]{40}$')),
	CONSTRAINT "speaker_migration_cutover_ordinals_positive" CHECK (("speaker_migration_cutover"."phase_aware_release_ordinal" IS NULL OR "speaker_migration_cutover"."phase_aware_release_ordinal" >= 1)
          AND ("speaker_migration_cutover"."minimum_compatible_release_ordinal" IS NULL OR "speaker_migration_cutover"."minimum_compatible_release_ordinal" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_migration_cutover_singleton_uniq" ON "speaker_migration_cutover" USING btree ("singleton");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- 012 EARS-24 / Issue #1633 — speaker-cutover SSOT + `event_speakers` fence.
--
-- Hand-managed SQL below the drizzle-kit output: drizzle-kit does not model
-- triggers, functions or seed rows (same split as 0013's audit triggers and
-- 0003's partition DDL; ADR-0003 §3.4).
--
-- WHAT THIS MIGRATION IS. The retained singleton created above is the database
-- SSOT of the legacy-speaker cutover (012-design §2.3). Two consumers read it
-- and neither can be trusted to a shared application process:
--
--   * the `event_speakers` writer fence below — which must also stop DIRECT DML
--     from a PRE-EXPAND application image that has never heard of the cutover;
--   * `pnpm deploy:prod --rollback <sha>` (tools/deploy/rollback-floor.mjs),
--     which reads `minimum_compatible_release_*` from production BEFORE any
--     provider mutation and refuses an older target image.
--
-- WHAT THIS MIGRATION IS NOT. `speaker_migration_reviews` (the admin review
-- queue), its duplicate-preserving import and the phase-aware readers belong to
-- #1607. The `event_speakers_enqueue_review_after_insert` trigger and the
-- `review_open` "UPDATE refused once the source has a retained review" clause
-- both address rows in that table, so they land WITH it in #1607 — recorded
-- explicitly rather than silently skipped. Everything that does not depend on
-- the queue (the SSOT, the `source_closed` total fence, the always-refused
-- DELETE) is delivered here and is not weakened by that split.
-- ═══════════════════════════════════════════════════════════════════════════
-- The singleton itself. Seeded in the migration, never by application code: the
-- fence trigger fails closed if the row is missing, so its existence is a schema
-- fact, not a bootstrap step someone can forget to run.
INSERT INTO "speaker_migration_cutover" ("singleton", "phase") VALUES (true, 'review_open');--> statement-breakpoint
-- Retained + monotonic SSOT guard. The CHECK constraints above make an
-- incoherent ROW unrepresentable; this trigger makes an incoherent TRANSITION
-- unrepresentable:
--   * physical deletion is always refused (retained-row lifecycle, §3.6);
--   * a second row is refused with a message that names the invariant (the
--     unique index would refuse it too, less legibly);
--   * `source_closed` never returns to `review_open` — the rollback floor the
--     deploy guard enforces would evaporate under a live production image;
--   * neither release ordinal ever moves BACKWARD or back to NULL, so the floor
--     can only ever rise;
--   * `version` and `updated_at` are maintained by the database, so a caller
--     that forgets them cannot produce a stale-looking row.
CREATE OR REPLACE FUNCTION speaker_migration_cutover_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'speaker_migration_cutover is retained (012-design 2.3): DELETE prohibited'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM speaker_migration_cutover) THEN
      RAISE EXCEPTION
        'speaker_migration_cutover is a singleton (012-design 2.3): a second row is prohibited'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.phase = 'source_closed' AND NEW.phase <> 'source_closed' THEN
    RAISE EXCEPTION
      'speaker migration phase is monotonic (012-design 2.3): source_closed cannot return to %',
      NEW.phase
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.phase_aware_release_ordinal IS NOT NULL
     AND (NEW.phase_aware_release_ordinal IS NULL
          OR NEW.phase_aware_release_ordinal < OLD.phase_aware_release_ordinal) THEN
    RAISE EXCEPTION
      'phase_aware_release_ordinal is monotonic: % cannot become %',
      OLD.phase_aware_release_ordinal, NEW.phase_aware_release_ordinal
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.minimum_compatible_release_ordinal IS NOT NULL
     AND (NEW.minimum_compatible_release_ordinal IS NULL
          OR NEW.minimum_compatible_release_ordinal < OLD.minimum_compatible_release_ordinal) THEN
    RAISE EXCEPTION
      'minimum_compatible_release_ordinal is the rollback floor and only rises: % cannot become %',
      OLD.minimum_compatible_release_ordinal, NEW.minimum_compatible_release_ordinal
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.id := OLD.id;
  NEW.singleton := true;
  NEW.created_at := OLD.created_at;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER speaker_migration_cutover_guard_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON "speaker_migration_cutover"
  FOR EACH ROW EXECUTE FUNCTION speaker_migration_cutover_guard();--> statement-breakpoint
-- feature-010 audit attachment (the EARS-8 coverage guard reads this line).
CREATE TRIGGER speaker_migration_cutover_audit AFTER INSERT OR UPDATE OR DELETE
  ON "speaker_migration_cutover" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- `event_speakers` writer fence (012-design 2.3, EARS-24).
--
-- ATTACHED TO THE TABLE, not to an application helper — that is the whole point.
-- A pre-expand image issuing raw INSERT/UPDATE/DELETE, a psql session, a
-- forgotten script: all of them go through this trigger.
--
-- `FOR UPDATE` on the singleton is load-bearing, not defensive style. It makes
-- the phase read and the legacy write ONE serialized decision, so the closure
-- transaction and a concurrent legacy INSERT can interleave only in the two
-- orders the scenarios specify: either the insert commits first and closure must
-- then account for it, or closure commits first and the blocked insert resumes
-- against `source_closed` and is rejected. There is no third outcome in which a
-- source row lands after the closed set was proved complete.
--
-- Restore, retire and reorder are all UPDATEs, so they need no separate clauses
-- — covering UPDATE covers all three, which is exactly why the fence lives here
-- rather than in one service method per operation.
CREATE OR REPLACE FUNCTION event_speakers_migration_fence() RETURNS trigger AS $$
DECLARE
  v_phase speaker_migration_phase;
BEGIN
  SELECT phase INTO v_phase FROM speaker_migration_cutover FOR UPDATE;

  IF NOT FOUND THEN
    -- Fail CLOSED. A missing SSOT means the fence cannot know the phase, and an
    -- unknowable phase must never read as "open".
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: speaker_migration_cutover singleton is missing; % on event_speakers refused',
      TG_OP
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_phase = 'source_closed' THEN
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: the legacy speaker source set is closed (phase source_closed); % on event_speakers refused',
      TG_OP
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Retained provenance: a source row is the evidence the review queue is
    -- keyed by, so it is never physically removed in any phase. Editorial
    -- removal is `record_status = 'retired'` + `content_removed_at`, an UPDATE.
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: event_speakers rows are retained provenance; DELETE refused'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER event_speakers_migration_fence_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON "event_speakers"
  FOR EACH ROW EXECUTE FUNCTION event_speakers_migration_fence();
