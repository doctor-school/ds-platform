-- 046 EARS-4..17 (#2433): a doctor's congress submissions (046-design §Data model).
-- Kind-generic table: oral talks (S2), posters (S3) and abstracts (S4) share it;
-- `revision_due_at` is created here and written by the committee's status route (S5).
CREATE TABLE "congress_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"derived_from_id" uuid,
	"statements" jsonb,
	"committee_comment" text,
	"submitted_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_due_at" timestamp with time zone,
	"last_letter_kind" text,
	"last_letter_status" text,
	"last_letter_at" timestamp with time zone,
	"reminded_for_closes_at" timestamp with time zone,
	"record_status" "record_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "congress_submissions_kind_known" CHECK ("congress_submissions"."kind" IN ('oral', 'poster', 'abstract')),
	CONSTRAINT "congress_submissions_status_known" CHECK ("congress_submissions"."status" IN ('draft', 'submitted', 'in_review', 'accepted', 'rejected', 'needs_revision', 'withdrawn')),
	CONSTRAINT "congress_submissions_retired_iff_deleted" CHECK (("congress_submissions"."record_status" = 'retired') = ("congress_submissions"."deleted_at" IS NOT NULL)),
	CONSTRAINT "congress_submissions_retired_only_draft" CHECK ("congress_submissions"."record_status" = 'active' OR "congress_submissions"."status" = 'draft'),
	CONSTRAINT "congress_submissions_last_letter_status_known" CHECK ("congress_submissions"."last_letter_status" IS NULL OR "congress_submissions"."last_letter_status" IN ('sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "congress_submissions" ADD CONSTRAINT "congress_submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "congress_submissions" ADD CONSTRAINT "congress_submissions_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "congress_submissions" ADD CONSTRAINT "congress_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "congress_submissions" ADD CONSTRAINT "congress_submissions_derived_from_id_congress_submissions_id_fk" FOREIGN KEY ("derived_from_id") REFERENCES "public"."congress_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "congress_submissions_user_event_kind_idx" ON "congress_submissions" USING btree ("user_id","event_id","kind");--> statement-breakpoint
CREATE INDEX "congress_submissions_event_status_idx" ON "congress_submissions" USING btree ("event_id","status");--> statement-breakpoint
-- feature-010 universal-edit-audit attachment: every submission write is an
-- audited mutation; the ledger is the status history the committee card shows
-- (046 EARS-28).
CREATE TRIGGER congress_submissions_audit AFTER INSERT OR UPDATE OR DELETE
  ON "congress_submissions" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- `congress_submissions` is PD-bearing: `authors` carries the names and
-- workplaces of the author and the co-authors the author supplies, so it is
-- masked out of ledger diffs (010-design §5; TS mirror `AUDIT_PD_COLUMNS` in
-- packages/db/src/audit.ts, parity asserted by universal-edit-audit.e2e-spec).
-- Status, dates and the content text stay visible: they are the history.
CREATE OR REPLACE FUNCTION audit_pd_columns(p_table text) RETURNS text[] AS $$
  SELECT CASE p_table
    WHEN 'users' THEN ARRAY['email', 'phone', 'display_name']
    WHEN 'consent_records' THEN ARRAY['user_id']
    WHEN 'registrations' THEN ARRAY['answers']
    WHEN 'congress_submissions' THEN ARRAY['authors']
    ELSE ARRAY[]::text[]
  END;
$$ LANGUAGE sql IMMUTABLE;
