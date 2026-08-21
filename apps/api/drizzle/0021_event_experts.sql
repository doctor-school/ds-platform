CREATE TYPE "public"."relationship_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "event_experts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"expert_id" uuid NOT NULL,
	"role" text,
	"position" integer NOT NULL,
	"legacy_speaker_id" uuid,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_experts_retired_iff_deleted" CHECK (("event_experts"."status" = 'retired') = ("event_experts"."deleted_at" IS NOT NULL)),
	CONSTRAINT "event_experts_role_bounds" CHECK ("event_experts"."role" IS NULL OR char_length("event_experts"."role") BETWEEN 1 AND 80),
	CONSTRAINT "event_experts_position_bounds" CHECK ("event_experts"."position" BETWEEN 0 AND 32767),
	CONSTRAINT "event_experts_version_positive" CHECK ("event_experts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "content_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_experts" ADD CONSTRAINT "event_experts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_experts" ADD CONSTRAINT "event_experts_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_experts" ADD CONSTRAINT "event_experts_event_legacy_speaker_fk" FOREIGN KEY ("event_id","legacy_speaker_id") REFERENCES "public"."event_speakers"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_experts_event_expert_key" ON "event_experts" USING btree ("event_id","expert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_experts_legacy_speaker_key" ON "event_experts" USING btree ("legacy_speaker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_experts_event_position_active_uniq" ON "event_experts" USING btree ("event_id","position") WHERE "event_experts"."status" = 'active';--> statement-breakpoint
-- ── 012 EARS-7 (#1289): feature-010 audit attachment. `event_experts` is domain
--    truth — the link decides which person the public speaker projection shows —
--    so it opts in exactly as `projects` (0015), `experts` (0016) and `topics`
--    (0017) did. Its `role` is ordinary audited editorial text (012-design §6)
--    and contributes no entry to feature-010's masked-column registry.
CREATE TRIGGER event_experts_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_experts" FOR EACH ROW EXECUTE FUNCTION audit_row_change();