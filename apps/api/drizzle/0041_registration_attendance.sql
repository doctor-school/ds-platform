-- 044 EARS-34 (#2381): per-day attendance of a registration (044-design §Data model).
-- One row per (registration, day); no author/time columns — the 010 ledger
-- answers who marked it and when. The allowed days are deployment config
-- (CONGRESS_SIGNUP_EVENT_DAYS), validated by the API, never a CHECK here.
CREATE TABLE "registration_attendance" (
	"registration_id" uuid NOT NULL,
	"day" date NOT NULL,
	"present" boolean NOT NULL,
	CONSTRAINT "registration_attendance_registration_id_day_pk" PRIMARY KEY("registration_id","day")
);
--> statement-breakpoint
ALTER TABLE "registration_attendance" ADD CONSTRAINT "registration_attendance_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- feature-010 universal-edit-audit attachment: every mark / unmark is an
-- audited mutation attributed to the acting registrar (source admin-ui). No PD
-- column: the row holds an id, a date and a flag, so no audit_pd_columns entry.
CREATE TRIGGER registration_attendance_audit AFTER INSERT OR UPDATE OR DELETE
  ON "registration_attendance" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
