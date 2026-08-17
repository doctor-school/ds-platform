CREATE TYPE "public"."idempotency_execution_state" AS ENUM('processing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."idempotency_record_status" AS ENUM('active', 'expired');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('school', 'media', 'program');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."media_cleanup_error" AS ENUM('object_storage_unavailable', 'cdn_unavailable', 'still_referenced', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."media_cleanup_execution_state" AS ENUM('pending', 'processing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."media_cleanup_kind" AS ENUM('replace', 'clear', 'content_removal');--> statement-breakpoint
CREATE TYPE "public"."media_cleanup_status" AS ENUM('active', 'expired');--> statement-breakpoint
CREATE TYPE "public"."media_entity_kind" AS ENUM('project', 'expert', 'partner');--> statement-breakpoint
CREATE TYPE "public"."media_slot" AS ENUM('cover', 'photo', 'logo');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "project_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_ref" text,
	"first_published_at" timestamp with time zone,
	"status" "taxonomy_status" DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_retired_iff_deleted" CHECK (("projects"."status" = 'retired') = ("projects"."deleted_at" IS NOT NULL)),
	CONSTRAINT "projects_slug_pattern" CHECK ("projects"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "projects_slug_not_uuid" CHECK ("projects"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "projects_title_bounds" CHECK (char_length("projects"."title") BETWEEN 1 AND 160),
	CONSTRAINT "projects_description_bounds" CHECK ("projects"."description" IS NULL OR char_length("projects"."description") BETWEEN 1 AND 2000),
	CONSTRAINT "projects_version_positive" CHECK ("projects"."version" >= 1),
	CONSTRAINT "projects_published_has_first_published_at" CHECK ("projects"."status" <> 'published' OR "projects"."first_published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "media_cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "media_cleanup_status" DEFAULT 'active' NOT NULL,
	"execution_state" "media_cleanup_execution_state" DEFAULT 'pending' NOT NULL,
	"cleanup_kind" "media_cleanup_kind" NOT NULL,
	"entity_kind" "media_entity_kind" NOT NULL,
	"entity_id" uuid,
	"slot" "media_slot" NOT NULL,
	"object_key" text,
	"cdn_key" text,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" "media_cleanup_error",
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_cleanup_jobs_expired_iff_deleted" CHECK (("media_cleanup_jobs"."status" = 'expired') = ("media_cleanup_jobs"."deleted_at" IS NOT NULL)),
	CONSTRAINT "media_cleanup_jobs_terminal_is_cleared" CHECK ("media_cleanup_jobs"."status" <> 'expired' OR (
        "media_cleanup_jobs"."execution_state" = 'completed'
        AND "media_cleanup_jobs"."object_key" IS NULL
        AND "media_cleanup_jobs"."cdn_key" IS NULL
        AND "media_cleanup_jobs"."entity_id" IS NULL
        AND "media_cleanup_jobs"."lease_owner" IS NULL
        AND "media_cleanup_jobs"."lease_expires_at" IS NULL
        AND "media_cleanup_jobs"."last_error" IS NULL
        AND "media_cleanup_jobs"."completed_at" IS NOT NULL
      )),
	CONSTRAINT "media_cleanup_jobs_active_has_locator" CHECK ("media_cleanup_jobs"."status" <> 'active' OR ("media_cleanup_jobs"."object_key" IS NOT NULL AND "media_cleanup_jobs"."entity_id" IS NOT NULL)),
	CONSTRAINT "media_cleanup_jobs_lease_epoch_non_negative" CHECK ("media_cleanup_jobs"."lease_epoch" >= 0),
	CONSTRAINT "media_cleanup_jobs_attempts_non_negative" CHECK ("media_cleanup_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "route" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_status" integer;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_body" jsonb;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_etag" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_location" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "execution_state" "idempotency_execution_state" DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "lease_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "cleanup_object_key" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "status" "idempotency_record_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_key" ON "projects" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_expired_iff_deleted" CHECK (("idempotency_keys"."status" = 'expired') = ("idempotency_keys"."deleted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_active_is_bound" CHECK ("idempotency_keys"."status" <> 'active' OR (
        "idempotency_keys"."method" IS NOT NULL
        AND "idempotency_keys"."route" IS NOT NULL
        AND "idempotency_keys"."request_fingerprint" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_expired_is_cleared" CHECK ("idempotency_keys"."status" <> 'expired' OR (
        "idempotency_keys"."actor_id" IS NULL
        AND "idempotency_keys"."method" IS NULL
        AND "idempotency_keys"."route" IS NULL
        AND "idempotency_keys"."request_fingerprint" IS NULL
        AND "idempotency_keys"."response_body" IS NULL
        AND "idempotency_keys"."response_etag" IS NULL
        AND "idempotency_keys"."response_location" IS NULL
        AND "idempotency_keys"."lease_owner" IS NULL
        AND "idempotency_keys"."lease_expires_at" IS NULL
      ));--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_lease_epoch_positive" CHECK ("idempotency_keys"."lease_epoch" >= 1);--> statement-breakpoint
-- ── 012 EARS-1 (#1283): feature-010 audit attachment for the new DOMAIN table.
--    One line per table, exactly as migration 0013 established. `projects` is
--    domain truth, so it opts in; `media_cleanup_jobs` deliberately does NOT —
--    it is the second and last taxonomy technical exclusion, named with its
--    rationale in `AUDIT_CAPTURE_ALLOWLIST` (packages/db/src/audit.ts) beside
--    `idempotency_keys`, and the allowlist-parity e2e asserts SQL ⇄ TS agreement.
CREATE TRIGGER projects_audit AFTER INSERT OR UPDATE OR DELETE
  ON "projects" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- ── 012-design §2.1: `first_published_at` is SET ONCE by the first publish
--    transaction, and a migration guard rejects clearing or changing it. A slug
--    is editable only while that column is NULL, so a mutable publication
--    instant would silently re-open a permanently locked public identity — the
--    URL a doctor bookmarked could then be handed to a different project. This
--    is enforced in the database, not only in the service, because the lock is
--    an invariant of the ROW rather than of one code path (a script, a psql
--    session or a future handler is bound by it too).
CREATE OR REPLACE FUNCTION taxonomy_first_published_at_set_once()
RETURNS trigger AS $$
BEGIN
  IF OLD.first_published_at IS NOT NULL
     AND (NEW.first_published_at IS NULL
          OR NEW.first_published_at <> OLD.first_published_at) THEN
    RAISE EXCEPTION
      'first_published_at is set once and cannot be cleared or changed (table %, id %)',
      TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER projects_first_published_at_set_once BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION taxonomy_first_published_at_set_once();
