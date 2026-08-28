CREATE TYPE "public"."doctor_specialty_role" AS ENUM('primary');--> statement-breakpoint
CREATE TABLE "doctor_specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"specialty_id" uuid NOT NULL,
	"role" "doctor_specialty_role" DEFAULT 'primary' NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_specialties_retired_iff_deleted" CHECK (("doctor_specialties"."status" = 'retired') = ("doctor_specialties"."deleted_at" IS NOT NULL)),
	CONSTRAINT "doctor_specialties_version_positive" CHECK ("doctor_specialties"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_specialty_id_specialties_minzdrav_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties_minzdrav"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_specialties_primary_active_uniq" ON "doctor_specialties" USING btree ("doctor_id") WHERE "doctor_specialties"."status" = 'active' AND "doctor_specialties"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "doctor_specialties_doctor_idx" ON "doctor_specialties" USING btree ("doctor_id");--> statement-breakpoint
-- 017 EARS-6 (#1482): feature-010 universal-edit-audit attachment.
-- `doctor_specialties` is domain truth about a person: the link controls which
-- targeted storefront content is served to the doctor. The public specialty
-- reference itself does not add a masked-column registry entry.
CREATE TRIGGER doctor_specialties_audit AFTER INSERT OR UPDATE OR DELETE
  ON "doctor_specialties" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
