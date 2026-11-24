CREATE TYPE "public"."feed_vk_object_kind" AS ENUM('post', 'video');--> statement-breakpoint
ALTER TYPE "public"."feed_entry_kind" ADD VALUE 'video';--> statement-breakpoint
ALTER TYPE "public"."feed_source_platform" ADD VALUE 'vk';--> statement-breakpoint
CREATE TABLE "feed_entry_vk_objects" (
	"feed_source_id" uuid NOT NULL,
	"vk_group_id" bigint NOT NULL,
	"object_kind" "feed_vk_object_kind" NOT NULL,
	"vk_object_id" bigint NOT NULL,
	"feed_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_entry_vk_objects_feed_source_id_vk_group_id_object_kind_vk_object_id_pk" PRIMARY KEY("feed_source_id","vk_group_id","object_kind","vk_object_id"),
	CONSTRAINT "feed_entry_vk_objects_object_id_positive" CHECK ("feed_entry_vk_objects"."vk_object_id" > 0),
	CONSTRAINT "feed_entry_vk_objects_group_id_positive" CHECK ("feed_entry_vk_objects"."vk_group_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "feed_vk_call_months" (
	"month" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_vk_call_months_calls_non_negative" CHECK ("feed_vk_call_months"."calls" >= 0),
	CONSTRAINT "feed_vk_call_months_first_day" CHECK (extract(day from "feed_vk_call_months"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "feed_sources" DROP CONSTRAINT "feed_sources_address_pattern";--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD COLUMN "vk_group_id" bigint;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD COLUMN "vk_last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_entry_vk_objects" ADD CONSTRAINT "feed_entry_vk_objects_feed_source_id_feed_sources_id_fk" FOREIGN KEY ("feed_source_id") REFERENCES "public"."feed_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_entry_vk_objects" ADD CONSTRAINT "feed_entry_vk_objects_feed_entry_id_feed_entries_id_fk" FOREIGN KEY ("feed_entry_id") REFERENCES "public"."feed_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_entry_vk_objects_feed_entry_id_idx" ON "feed_entry_vk_objects" USING btree ("feed_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_sources_vk_group_id_key" ON "feed_sources" USING btree ("vk_group_id");--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_video_is_vk" CHECK ("feed_entries"."kind"::text <> 'video' OR "feed_entries"."source_platform"::text = 'vk');--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_vk_image_is_url" CHECK ("feed_entries"."source_platform"::text <> 'vk' OR "feed_entries"."image_ref" IS NULL);--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_academy_not_removed" CHECK ("feed_entries"."source_platform" <> 'academy' OR "feed_entries"."removed_at" IS NULL);--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_vk_columns_vk_only" CHECK ("feed_sources"."platform"::text = 'vk' OR ("feed_sources"."vk_group_id" IS NULL AND "feed_sources"."vk_last_event_at" IS NULL));--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_vk_group_id_positive" CHECK ("feed_sources"."vk_group_id" IS NULL OR "feed_sources"."vk_group_id" > 0);--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_address_pattern" CHECK (CASE WHEN "feed_sources"."platform"::text = 'vk' THEN "feed_sources"."address" ~ '^[a-z0-9_.]{2,32}$' ELSE "feed_sources"."address" ~ '^[a-z][a-z0-9_]{4,31}$' END);--> statement-breakpoint
-- ── feature-010 audit attachment (048 EARS-43) ─────────────────────────────
-- `feed_entries` and `feed_sources` keep their row triggers, which capture the
-- new `removed_at`, `vk_group_id` and `vk_last_event_at` columns with the row;
-- `feed_vk_call_months` is an operational counter (packages/db/src/audit.ts).
CREATE TRIGGER feed_entry_vk_objects_audit AFTER INSERT OR UPDATE OR DELETE
  ON "feed_entry_vk_objects" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
