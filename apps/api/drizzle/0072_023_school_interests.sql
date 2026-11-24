CREATE TYPE "public"."learning_school_interest_state" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TABLE "learning_school_interests" (
	"person_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"state" "learning_school_interest_state" DEFAULT 'active' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	CONSTRAINT "learning_school_interests_person_id_school_id_pk" PRIMARY KEY("person_id","school_id")
);
--> statement-breakpoint
ALTER TABLE "learning_school_interests" ADD CONSTRAINT "learning_school_interests_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_school_interests" ADD CONSTRAINT "learning_school_interests_school_id_learning_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."learning_schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_school_interests_school_idx" ON "learning_school_interests" USING btree ("school_id","state");--> statement-breakpoint
-- 010 change audit, as every 024 / 023 doctor table (0065).
CREATE TRIGGER learning_school_interests_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_school_interests" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
