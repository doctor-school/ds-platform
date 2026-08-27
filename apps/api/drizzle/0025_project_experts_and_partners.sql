CREATE TYPE "public"."project_expert_role" AS ENUM('curator', 'member');--> statement-breakpoint
CREATE TABLE "project_experts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"expert_id" uuid NOT NULL,
	"role" "project_expert_role" NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_experts_retired_iff_deleted" CHECK (("project_experts"."status" = 'retired') = ("project_experts"."deleted_at" IS NOT NULL)),
	CONSTRAINT "project_experts_version_positive" CHECK ("project_experts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_partners_retired_iff_deleted" CHECK (("project_partners"."status" = 'retired') = ("project_partners"."deleted_at" IS NOT NULL)),
	CONSTRAINT "project_partners_version_positive" CHECK ("project_partners"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "project_experts" ADD CONSTRAINT "project_experts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_experts" ADD CONSTRAINT "project_experts_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_partners" ADD CONSTRAINT "project_partners_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_partners" ADD CONSTRAINT "project_partners_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_experts_pair_key" ON "project_experts" USING btree ("project_id","expert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_experts_project_curator_active_uniq" ON "project_experts" USING btree ("project_id") WHERE "project_experts"."status" = 'active' AND "project_experts"."role" = 'curator';--> statement-breakpoint
CREATE INDEX "project_experts_expert_id_idx" ON "project_experts" USING btree ("expert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_partners_pair_key" ON "project_partners" USING btree ("project_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_partners_project_primary_active_uniq" ON "project_partners" USING btree ("project_id") WHERE "project_partners"."status" = 'active' AND "project_partners"."is_primary";--> statement-breakpoint
CREATE INDEX "project_partners_partner_id_idx" ON "project_partners" USING btree ("partner_id");--> statement-breakpoint
-- ── 012 EARS-9/EARS-10 (#1291/#1292): feature-010 audit attachment for the two
--    new DOMAIN tables. One line per table, exactly as migrations 0013, 0020,
--    0021 and 0022 established. WHO made this expert the curator of this
--    project, and WHO moved the primary-partner flag, is precisely the question
--    the ledger exists to answer, so both tables opt IN. The taxonomy technical
--    exclusions remain exactly two (`idempotency_keys`, `media_cleanup_jobs`,
--    012-design §6); neither table is in `AUDIT_CAPTURE_ALLOWLIST`
--    (packages/db/src/audit.ts) and the EARS-8 coverage guard would turn CI red
--    if either trigger below were missing.
--
--    No `audit_pd_columns()` regeneration accompanies this migration: 012-design
--    §6 classifies the 012 join columns as PLAIN audited diffs. `expert_id` is a
--    foreign key to a record whose own PD masking is decided on `experts`, and
--    `role`/`is_primary` are structural enums, so masking them here would erase
--    the diff without protecting anything.
CREATE TRIGGER project_experts_audit AFTER INSERT OR UPDATE OR DELETE
  ON "project_experts" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER project_partners_audit AFTER INSERT OR UPDATE OR DELETE
  ON "project_partners" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
