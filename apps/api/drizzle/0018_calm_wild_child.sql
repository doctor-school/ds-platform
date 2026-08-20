CREATE TYPE "public"."recording_kind" AS ENUM('edited', 'raw');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TABLE "event_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" "recording_kind" NOT NULL,
	"provider" "stream_provider" NOT NULL,
	"embed_ref" text NOT NULL,
	"poster_ref" text,
	"duration_sec" integer,
	"status" "recording_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_recordings_retired_iff_deleted" CHECK (("event_recordings"."status" = 'retired') = ("event_recordings"."deleted_at" IS NOT NULL)),
	CONSTRAINT "event_recordings_published_has_first_published_at" CHECK ("event_recordings"."status" <> 'published' OR "event_recordings"."first_published_at" IS NOT NULL),
	CONSTRAINT "event_recordings_embed_ref_bounds" CHECK (char_length("event_recordings"."embed_ref") BETWEEN 1 AND 500),
	CONSTRAINT "event_recordings_poster_ref_bounds" CHECK ("event_recordings"."poster_ref" IS NULL OR char_length("event_recordings"."poster_ref") BETWEEN 1 AND 500),
	CONSTRAINT "event_recordings_duration_bounds" CHECK ("event_recordings"."duration_sec" IS NULL OR ("event_recordings"."duration_sec" > 0 AND "event_recordings"."duration_sec" <= 86400)),
	CONSTRAINT "event_recordings_version_positive" CHECK ("event_recordings"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recording_expected_by" date;--> statement-breakpoint
ALTER TABLE "event_recordings" ADD CONSTRAINT "event_recordings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_recordings_event_kind_active_uniq" ON "event_recordings" USING btree ("event_id","kind") WHERE "event_recordings"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_recordings_event_published_idx" ON "event_recordings" USING btree ("event_id","kind") WHERE "event_recordings"."status" = 'published' AND "event_recordings"."deleted_at" IS NULL;--> statement-breakpoint
-- ── 014 EARS-1 (#1339): feature-010 audit attachment for the new DOMAIN table.
--    One line per table, exactly as migrations 0013 and 0015 established.
--    `event_recordings` is domain truth — every attach, edit and lifecycle move
--    is an operator act on published content — so it opts in and is deliberately
--    NOT in `AUDIT_CAPTURE_ALLOWLIST` (packages/db/src/audit.ts); the
--    allowlist-parity e2e asserts SQL ⇄ TS agreement.
CREATE TRIGGER event_recordings_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_recordings" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- ── 014-design §3: `first_published_at` is SET ONCE by the first publish and is
--    never cleared by unpublish, retire or restore — "when did this recording
--    first become visible" is a fact about the ROW, so it is pinned in the
--    database rather than only in the service (a script or a psql session is
--    bound by it too). The guard function already exists from migration 0015
--    (`taxonomy_first_published_at_set_once`) and is REUSED verbatim: it keys off
--    OLD/NEW.first_published_at and TG_TABLE_NAME, so it is table-agnostic and
--    there is no second copy to drift.
CREATE TRIGGER event_recordings_first_published_at_set_once BEFORE UPDATE
  ON "event_recordings" FOR EACH ROW
  EXECUTE FUNCTION taxonomy_first_published_at_set_once();
