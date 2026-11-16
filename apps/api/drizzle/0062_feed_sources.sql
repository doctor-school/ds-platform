CREATE TYPE "public"."feed_entry_preview_state" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."feed_source_status" AS ENUM('unchecked', 'ok', 'failing');--> statement-breakpoint
ALTER TYPE "public"."feed_source_platform" ADD VALUE 'telegram';--> statement-breakpoint
CREATE TABLE "feed_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "feed_source_platform" NOT NULL,
	"address" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"telegram_chat_id" bigint,
	"status" "feed_source_status" DEFAULT 'unchecked' NOT NULL,
	"status_reason" text,
	"checked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_sources_network_platform" CHECK ("feed_sources"."platform" <> 'academy'),
	CONSTRAINT "feed_sources_address_pattern" CHECK ("feed_sources"."address" ~ '^[a-z][a-z0-9_]{4,31}$'),
	CONSTRAINT "feed_sources_reason_iff_failing" CHECK (("feed_sources"."status" = 'failing') = ("feed_sources"."status_reason" IS NOT NULL)),
	CONSTRAINT "feed_sources_checked_has_time" CHECK ("feed_sources"."status" = 'unchecked' OR "feed_sources"."checked_at" IS NOT NULL),
	CONSTRAINT "feed_sources_version_positive" CHECK ("feed_sources"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "feed_source_id" uuid;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "media_group_id" text;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "preview_file_id" text;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "preview_file_unique_id" text;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "preview_state" "feed_entry_preview_state";--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "preview_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "source_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_sources_platform_address_key" ON "feed_sources" USING btree ("platform","address");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_sources_telegram_chat_id_key" ON "feed_sources" USING btree ("telegram_chat_id");--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_feed_source_id_feed_sources_id_fk" FOREIGN KEY ("feed_source_id") REFERENCES "public"."feed_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_entries_feed_source_id_published_at_idx" ON "feed_entries" USING btree ("feed_source_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "feed_entries_source_media_group_key" ON "feed_entries" USING btree ("feed_source_id","media_group_id");--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_network_has_source" CHECK (("feed_entries"."source_platform" = 'academy') = ("feed_entries"."feed_source_id" IS NULL));--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_post_is_network" CHECK ("feed_entries"."kind"::text <> 'post' OR "feed_entries"."source_platform" <> 'academy');--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_duration_non_negative" CHECK ("feed_entries"."duration_seconds" IS NULL OR "feed_entries"."duration_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_preview_attempts_non_negative" CHECK ("feed_entries"."preview_attempts" >= 0);--> statement-breakpoint
-- ── feature-010 audit attachment (048 EARS-23) ─────────────────────────────
CREATE TRIGGER feed_sources_audit AFTER INSERT OR UPDATE OR DELETE
  ON "feed_sources" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
