CREATE TABLE "event_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_projects_retired_iff_deleted" CHECK (("event_projects"."status" = 'retired') = ("event_projects"."deleted_at" IS NOT NULL)),
	CONSTRAINT "event_projects_version_positive" CHECK ("event_projects"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_projects" ADD CONSTRAINT "event_projects_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_projects" ADD CONSTRAINT "event_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_projects_pair_key" ON "event_projects" USING btree ("event_id","project_id");--> statement-breakpoint
CREATE INDEX "event_projects_project_id_idx" ON "event_projects" USING btree ("project_id");--> statement-breakpoint
-- ── 012 EARS-6 (#1288): feature-010 audit attachment for the new DOMAIN table.
--    One line per table, exactly as migrations 0013 and 0020 established. A
--    relationship is domain truth — WHO linked this project to this broadcast,
--    and WHO later retired that link, is precisely the question the ledger
--    exists to answer — so `event_projects` opts IN. The taxonomy technical
--    exclusions remain exactly two (`idempotency_keys`, `media_cleanup_jobs`,
--    012-design §6); this table is in neither set of `AUDIT_CAPTURE_ALLOWLIST`
--    (packages/db/src/audit.ts) and the EARS-8 coverage guard would turn CI red
--    if the trigger below were missing.
CREATE TRIGGER event_projects_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_projects" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
