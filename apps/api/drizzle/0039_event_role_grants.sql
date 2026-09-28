CREATE TABLE "event_role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_role_grants_role_known" CHECK ("event_role_grants"."role" IN ('event-registrar'))
);
--> statement-breakpoint
ALTER TABLE "event_role_grants" ADD CONSTRAINT "event_role_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_role_grants" ADD CONSTRAINT "event_role_grants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_role_grants_registrar_user_uniq" ON "event_role_grants" USING btree ("user_id","role") WHERE "event_role_grants"."role" = 'event-registrar';--> statement-breakpoint
CREATE INDEX "event_role_grants_event_idx" ON "event_role_grants" USING btree ("event_id");--> statement-breakpoint
-- 044 EARS-38 (#2384): feature-010 universal-edit-audit attachment. A grant is
-- itself an audited mutation — `audit_ledger` answers who bound whom to which
-- event, and when. Until the grants screen (#2378) the tech lead inserts rows by
-- hand, which the trigger honestly records as `db-direct`. No PD column: the row
-- holds only ids and a role name, so no `audit_pd_columns` entry.
CREATE TRIGGER event_role_grants_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_role_grants" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
