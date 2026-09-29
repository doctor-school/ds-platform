-- 046 EARS-1..3 (#2432): congress intake settings per event and per kind
-- (046-design §Data model). Dates are stored instants: opening = 00:00 Moscow
-- of the opening day, each closing = 00:00 Moscow of the day after the last day.
-- The CHECKs restate the EARS-2 server refusals at the storage layer.
CREATE TABLE "congress_submission_kind_settings" (
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"submit_limit" integer,
	"max_age_years" integer,
	CONSTRAINT "congress_submission_kind_settings_event_id_kind_pk" PRIMARY KEY("event_id","kind"),
	CONSTRAINT "congress_submission_kind_settings_kind_known" CHECK ("congress_submission_kind_settings"."kind" IN ('oral', 'poster', 'abstract')),
	CONSTRAINT "congress_submission_kind_settings_opening_needs_closing" CHECK ("congress_submission_kind_settings"."opens_at" IS NULL OR "congress_submission_kind_settings"."closes_at" IS NOT NULL),
	CONSTRAINT "congress_submission_kind_settings_closing_after_opening" CHECK ("congress_submission_kind_settings"."opens_at" IS NULL OR "congress_submission_kind_settings"."closes_at" > "congress_submission_kind_settings"."opens_at"),
	CONSTRAINT "congress_submission_kind_settings_limit_positive" CHECK ("congress_submission_kind_settings"."submit_limit" IS NULL OR "congress_submission_kind_settings"."submit_limit" > 0),
	CONSTRAINT "congress_submission_kind_settings_age_range" CHECK ("congress_submission_kind_settings"."max_age_years" IS NULL OR "congress_submission_kind_settings"."max_age_years" BETWEEN 18 AND 99)
);
--> statement-breakpoint
CREATE TABLE "congress_submission_settings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"registration_url" text,
	"first_author_counts" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "congress_submission_kind_settings" ADD CONSTRAINT "congress_submission_kind_settings_event_id_congress_submission_settings_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."congress_submission_settings"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "congress_submission_settings" ADD CONSTRAINT "congress_submission_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- feature-010 universal-edit-audit attachment: every settings change is an
-- audited mutation attributed to the acting platform administrator (source
-- admin-ui) — the ledger answers «who moved the deadline». No PD column.
CREATE TRIGGER congress_submission_settings_audit AFTER INSERT OR UPDATE OR DELETE
  ON "congress_submission_settings" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER congress_submission_kind_settings_audit AFTER INSERT OR UPDATE OR DELETE
  ON "congress_submission_kind_settings" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
