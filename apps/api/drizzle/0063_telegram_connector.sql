ALTER TYPE "public"."feed_entry_kind" ADD VALUE 'post';--> statement-breakpoint
CREATE TABLE "feed_entry_messages" (
	"feed_source_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"feed_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_entry_messages_feed_source_id_message_id_pk" PRIMARY KEY("feed_source_id","message_id"),
	CONSTRAINT "feed_entry_messages_message_id_positive" CHECK ("feed_entry_messages"."message_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "feed_entries" DROP CONSTRAINT "feed_entries_title_bounds";--> statement-breakpoint
ALTER TABLE "feed_entry_messages" ADD CONSTRAINT "feed_entry_messages_feed_source_id_feed_sources_id_fk" FOREIGN KEY ("feed_source_id") REFERENCES "public"."feed_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_entry_messages" ADD CONSTRAINT "feed_entry_messages_feed_entry_id_feed_entries_id_fk" FOREIGN KEY ("feed_entry_id") REFERENCES "public"."feed_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_entry_messages_feed_entry_id_idx" ON "feed_entry_messages" USING btree ("feed_entry_id");--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_title_bounds" CHECK (CASE WHEN "feed_entries"."kind"::text = 'post' THEN char_length("feed_entries"."title") <= 501 ELSE char_length("feed_entries"."title") BETWEEN 1 AND 160 END);--> statement-breakpoint
-- ── feature-010 audit attachment (048 EARS-25, EARS-27) ────────────────────
CREATE TRIGGER feed_entry_messages_audit AFTER INSERT OR UPDATE OR DELETE
  ON "feed_entry_messages" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
