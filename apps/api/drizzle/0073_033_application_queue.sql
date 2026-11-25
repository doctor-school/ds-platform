CREATE TABLE "application_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"author_admin_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_notes_body_check" CHECK (char_length("application_notes"."body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"outcome" text,
	"applicant_user_id" uuid,
	"payload" jsonb NOT NULL,
	"contact" jsonb,
	"subject_line" text,
	"consent_record_id" uuid,
	"consent_purpose" text NOT NULL,
	"consent_version_tag" text NOT NULL,
	"idempotency_key" uuid,
	"legacy_record_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"team_notice" text DEFAULT 'pending' NOT NULL,
	"receipt_notice" text DEFAULT 'pending' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"closed_at" timestamp with time zone,
	"pd_erased_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "applications_kind_check" CHECK ("applications"."kind" IN ('author')),
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('new', 'in_review', 'closed')),
	CONSTRAINT "applications_outcome_check" CHECK ("applications"."outcome" IS NULL OR "applications"."outcome" IN ('accepted', 'declined', 'expired')),
	CONSTRAINT "applications_closed_check" CHECK (("applications"."status" = 'closed') = ("applications"."outcome" IS NOT NULL) AND ("applications"."status" = 'closed') = ("applications"."closed_at" IS NOT NULL)),
	CONSTRAINT "applications_author_check" CHECK ("applications"."kind" <> 'author' OR "applications"."pd_erased_at" IS NOT NULL OR ("applications"."applicant_user_id" IS NOT NULL AND "applications"."consent_record_id" IS NOT NULL)),
	CONSTRAINT "applications_tombstone_check" CHECK (("applications"."payload" = '{"erased": true}'::jsonb) = ("applications"."pd_erased_at" IS NOT NULL) AND ("applications"."pd_erased_at" IS NULL OR ("applications"."contact" IS NULL AND "applications"."subject_line" IS NULL AND "applications"."applicant_user_id" IS NULL))),
	CONSTRAINT "applications_team_notice_check" CHECK ("applications"."team_notice" IN ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "applications_receipt_notice_check" CHECK ("applications"."receipt_notice" IN ('pending', 'sent', 'failed', 'not_applicable'))
);
--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_notes_application_idx" ON "application_notes" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "applications_submitted_idx" ON "applications" USING btree ("submitted_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "applications_kind_status_submitted_idx" ON "applications" USING btree ("kind","status","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "applications_open_applicant_idx" ON "applications" USING btree ("applicant_user_id") WHERE "applications"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "applications_open_clock_idx" ON "applications" USING btree (coalesce("status_changed_at", "submitted_at")) WHERE "applications"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "applications_erase_due_idx" ON "applications" USING btree ("closed_at") WHERE "applications"."pd_erased_at" IS NULL;--> statement-breakpoint
CREATE INDEX "applications_applicant_idx" ON "applications" USING btree ("applicant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_kind_idempotency_key_uniq" ON "applications" USING btree ("kind","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_legacy_record_id_uniq" ON "applications" USING btree ("legacy_record_id");--> statement-breakpoint
-- ── feature-010 PD-column registry (033 EARS-25) ────────────────────────────
-- The queue's personal-data columns join the registry so the 010 capture
-- trigger writes them masked into the ledger, never their values. Mirrors
-- `AUDIT_PD_COLUMNS` in packages/db/src/audit.ts (the parity e2e asserts it).
CREATE OR REPLACE FUNCTION audit_pd_columns(p_table text) RETURNS text[] AS $$
  SELECT CASE p_table
    WHEN 'users' THEN ARRAY['email', 'phone', 'display_name']
    WHEN 'consent_records' THEN ARRAY['user_id']
    WHEN 'registrations' THEN ARRAY['answers']
    WHEN 'congress_submissions' THEN ARRAY['authors']
    WHEN 'learning_feedback' THEN ARRAY['text']
    WHEN 'applications' THEN ARRAY['payload', 'contact', 'subject_line']
    WHEN 'application_notes' THEN ARRAY['body']
    ELSE ARRAY[]::text[]
  END;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
-- ── feature-010 audit attachment (010 EARS-8) ──────────────────────────────
CREATE TRIGGER applications_audit AFTER INSERT OR UPDATE OR DELETE
  ON "applications" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER application_notes_audit AFTER INSERT OR UPDATE OR DELETE
  ON "application_notes" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
