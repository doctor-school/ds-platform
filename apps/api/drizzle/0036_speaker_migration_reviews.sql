CREATE TYPE "public"."speaker_migration_classification" AS ENUM('unmatched', 'ambiguous', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."speaker_migration_disposition" AS ENUM('unresolved', 'existing_expert', 'created_expert', 'content_removed');--> statement-breakpoint
CREATE TABLE "speaker_migration_reviews" (
	"source_speaker_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"source_position" integer NOT NULL,
	"source_name" text NOT NULL,
	"source_regalia" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"original_classification" "speaker_migration_classification" NOT NULL,
	"disposition" "speaker_migration_disposition" DEFAULT 'unresolved' NOT NULL,
	"resolved_expert_id" uuid,
	"event_expert_id" uuid,
	"resolved_role" text,
	"resolved_position" integer,
	"reviewer_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaker_migration_reviews_fingerprint_shape" CHECK ("speaker_migration_reviews"."content_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "speaker_migration_reviews_source_position_bounds" CHECK ("speaker_migration_reviews"."source_position" BETWEEN 0 AND 32767),
	CONSTRAINT "speaker_migration_reviews_resolution_shape" CHECK ((
        ("speaker_migration_reviews"."disposition" = 'unresolved' AND "speaker_migration_reviews"."resolved_expert_id" IS NULL AND "speaker_migration_reviews"."event_expert_id" IS NULL AND "speaker_migration_reviews"."resolved_role" IS NULL AND "speaker_migration_reviews"."resolved_position" IS NULL AND "speaker_migration_reviews"."reviewer_id" IS NULL AND "speaker_migration_reviews"."reviewed_at" IS NULL)
        OR
        ("speaker_migration_reviews"."disposition" IN ('existing_expert', 'created_expert') AND "speaker_migration_reviews"."resolved_expert_id" IS NOT NULL AND "speaker_migration_reviews"."event_expert_id" IS NOT NULL AND "speaker_migration_reviews"."resolved_role" IS NOT NULL AND "speaker_migration_reviews"."resolved_position" IS NOT NULL AND "speaker_migration_reviews"."reviewer_id" IS NOT NULL AND "speaker_migration_reviews"."reviewed_at" IS NOT NULL)
        OR
        ("speaker_migration_reviews"."disposition" = 'content_removed' AND "speaker_migration_reviews"."resolved_expert_id" IS NULL AND "speaker_migration_reviews"."event_expert_id" IS NULL AND "speaker_migration_reviews"."resolved_role" IS NULL AND "speaker_migration_reviews"."resolved_position" IS NULL AND "speaker_migration_reviews"."reviewer_id" IS NOT NULL AND "speaker_migration_reviews"."reviewed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "speaker_migration_reviews" ADD CONSTRAINT "speaker_migration_reviews_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_migration_reviews" ADD CONSTRAINT "speaker_migration_reviews_resolved_expert_id_experts_id_fk" FOREIGN KEY ("resolved_expert_id") REFERENCES "public"."experts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_migration_reviews" ADD CONSTRAINT "speaker_migration_reviews_event_expert_id_event_experts_id_fk" FOREIGN KEY ("event_expert_id") REFERENCES "public"."event_experts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_migration_reviews" ADD CONSTRAINT "speaker_migration_reviews_source_fk" FOREIGN KEY ("event_id","source_speaker_id") REFERENCES "public"."event_speakers"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_migration_reviews_event_expert_key" ON "speaker_migration_reviews" USING btree ("event_expert_id");--> statement-breakpoint
CREATE INDEX "speaker_migration_reviews_queue_idx" ON "speaker_migration_reviews" USING btree ("disposition","created_at","source_speaker_id");--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════════
-- 012 EARS-24 / Issue #1607 — the legacy-speaker review queue, its immutability
-- guard, the atomic `unmatched` enqueue trigger and the `review_open` half of
-- the `event_speakers` fence.
--
-- 0032 (#1633) deliberately deferred exactly these three things to this
-- migration, naming them in its own header: the queue table, the
-- `event_speakers_enqueue_review_after_insert` trigger, and the `review_open`
-- clause "UPDATE refused once the source has a retained review". Everything
-- else about the cutover — the retained SSOT singleton, the `source_closed`
-- total fence, the always-refused DELETE, the rollback floor — belongs to 0032
-- and is CONSUMED here, never re-created (012-design §2.3).
--
-- Hand-managed SQL below the drizzle-kit output: drizzle-kit models neither
-- triggers nor functions (same split as 0013 and 0032; ADR-0003 §3.4).
-- ═══════════════════════════════════════════════════════════════════════════

-- ONE definition of the provenance content fingerprint. The enqueue trigger and
-- the duplicate-preserving import both call it, so a row imported at expand and
-- a row inserted a minute later are fingerprinted identically — a second
-- definition in application code is precisely how those two would drift.
--
-- It fingerprints retained CONTENT, not identity: it is never compared between
-- two different source rows, never normalized, and nothing in this feature
-- derives a candidate, a match or a suggestion from it. It exists so a later
-- reader can prove the queue row still describes the source row it came from.
CREATE OR REPLACE FUNCTION speaker_migration_content_fingerprint(
  p_name text, p_regalia text
) RETURNS text AS $$
  SELECT encode(
    sha256(convert_to(coalesce(p_name, '') || chr(31) || coalesce(p_regalia, ''), 'UTF8')),
    'hex'
  );
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
-- Retained review rows. Provenance and the original classification are pinned
-- by the database, not by a service convention: the queue is the audit trail of
-- the migration, so a later editorial pass must not be able to rewrite what the
-- owner originally classified. Disposition moves exactly once, from
-- `unresolved` to a terminal value, and never back or sideways.
CREATE OR REPLACE FUNCTION speaker_migration_reviews_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: speaker_migration_reviews rows are retained provenance; DELETE refused'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.source_speaker_id <> OLD.source_speaker_id
     OR NEW.event_id <> OLD.event_id
     OR NEW.source_position <> OLD.source_position
     OR NEW.source_name <> OLD.source_name
     OR NEW.source_regalia <> OLD.source_regalia
     OR NEW.content_fingerprint <> OLD.content_fingerprint
     OR NEW.original_classification <> OLD.original_classification THEN
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: migration-review provenance and original classification are immutable (012-design 2.3)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.disposition <> 'unresolved' AND NEW.disposition <> OLD.disposition THEN
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: migration-review disposition is terminal: % cannot become %',
      OLD.disposition, NEW.disposition
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER speaker_migration_reviews_guard_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON "speaker_migration_reviews"
  FOR EACH ROW EXECUTE FUNCTION speaker_migration_reviews_guard();--> statement-breakpoint
-- feature-010 audit attachment (012-design §9: feature 010 wraps taxonomy
-- entities, relationships and `speaker_migration_reviews`).
CREATE TRIGGER speaker_migration_reviews_audit AFTER INSERT OR UPDATE OR DELETE
  ON "speaker_migration_reviews" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- Atomic enqueue of a source row inserted while the queue is open (EARS-24).
--
-- ATTACHED TO THE TABLE for the same reason the fence is: the review must exist
-- in the SAME transaction as the source row, whatever inserted it. An
-- application "also enqueue it" step would leave a window in which a committed
-- source row has no review — and the closure transaction proves exact
-- source↔queue coverage, so that window is exactly the one that would make
-- closure impossible to trust.
--
-- The classification of such a row is `unmatched` because nothing is known
-- about it: no name, no normalization and no expert record is consulted here or
-- anywhere else in this feature. `unmatched` is the neutral "an operator must
-- look at this" value, not a guess.
--
-- The fence BEFORE trigger has already refused the insert in `source_closed`,
-- so reaching this trigger means the phase is `review_open` and this
-- transaction already holds the singleton lock.
CREATE OR REPLACE FUNCTION event_speakers_enqueue_review() RETURNS trigger AS $$
BEGIN
  INSERT INTO speaker_migration_reviews (
    source_speaker_id, event_id, source_position, source_name, source_regalia,
    content_fingerprint, original_classification, disposition
  ) VALUES (
    NEW.id, NEW.event_id, NEW.position, NEW.name, NEW.regalia,
    speaker_migration_content_fingerprint(NEW.name, NEW.regalia),
    'unmatched', 'unresolved'
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER event_speakers_enqueue_review_after_insert
  AFTER INSERT ON "event_speakers"
  FOR EACH ROW EXECUTE FUNCTION event_speakers_enqueue_review();--> statement-breakpoint
-- The `review_open` half of the fence, deferred here by 0032 because it is a
-- statement about `speaker_migration_reviews`, which did not exist yet.
--
-- REPLACES the 0032 function body; every other clause below came from 0032
-- unchanged and is re-stated because `CREATE OR REPLACE FUNCTION` has no patch
-- form. The trigger itself is 0032's and is NOT re-created.
--
-- What is new: in `review_open` an UPDATE is refused once the source row has a
-- retained review. From the moment the queue is imported the legacy set is
-- append-only — restore, retire and reorder are all UPDATEs, so all three are
-- refused, which is what makes the imported provenance snapshot true for the
-- whole review window rather than only at the instant of import.
CREATE OR REPLACE FUNCTION event_speakers_migration_fence() RETURNS trigger AS $$
DECLARE
  v_phase speaker_migration_phase;
BEGIN
  SELECT phase INTO v_phase FROM speaker_migration_cutover FOR UPDATE;

  IF NOT FOUND THEN
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
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: event_speakers rows are retained provenance; DELETE refused'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE'
     AND EXISTS (
       SELECT 1 FROM speaker_migration_reviews r
       WHERE r.source_speaker_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'SPEAKER_MIGRATION_SOURCE_IMMUTABLE: source row % has a retained migration review; UPDATE refused in review_open',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
