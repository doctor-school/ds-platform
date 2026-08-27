CREATE TABLE "event_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_topics_retired_iff_deleted" CHECK (("event_topics"."status" = 'retired') = ("event_topics"."deleted_at" IS NOT NULL)),
	CONSTRAINT "event_topics_version_positive" CHECK ("event_topics"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_topics" ADD CONSTRAINT "event_topics_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_topics" ADD CONSTRAINT "event_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_topics_pair_key" ON "event_topics" USING btree ("event_id","topic_id");--> statement-breakpoint
CREATE INDEX "event_topics_topic_id_idx" ON "event_topics" USING btree ("topic_id");--> statement-breakpoint
-- ── 012 EARS-11 (#1293): feature-010 audit attachment for the new DOMAIN table.
--    One line per table, exactly as migrations 0013, 0020 and 0022 established. A
--    relationship is domain truth — WHO classified this broadcast under this
--    topic, and WHO later retired that classification, is precisely the question
--    the ledger exists to answer — so `event_topics` opts IN. The taxonomy
--    technical exclusions remain exactly two (`idempotency_keys`,
--    `media_cleanup_jobs`, 012-design §6); this table is in neither set of
--    `AUDIT_CAPTURE_ALLOWLIST` (packages/db/src/audit.ts) and the EARS-8 coverage
--    guard would turn CI red if the trigger below were missing.
CREATE TRIGGER event_topics_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_topics" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
