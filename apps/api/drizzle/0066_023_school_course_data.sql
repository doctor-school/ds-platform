CREATE TYPE "public"."learning_document_kind" AS ENUM('certificate', 'certificate-nmo');--> statement-breakpoint
ALTER TABLE "learning_courses" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD COLUMN "academic_hours" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD COLUMN "document_kind" "learning_document_kind" DEFAULT 'certificate' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD COLUMN "document_prerequisites" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD COLUMN "partner_organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD COLUMN "facts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD COLUMN "soon_note" text;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD COLUMN "community_url" text;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD COLUMN "mentoring_offer" text;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD COLUMN "internship_offer" text;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_courses_school_idx" ON "learning_courses" USING btree ("school_id","position");--> statement-breakpoint
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_academic_hours_min" CHECK ("learning_courses"."academic_hours" >= 0);--> statement-breakpoint
ALTER TABLE "learning_schools" ADD CONSTRAINT "learning_schools_facts_max" CHECK (jsonb_typeof("learning_schools"."facts") = 'array' AND jsonb_array_length("learning_schools"."facts") <= 4);