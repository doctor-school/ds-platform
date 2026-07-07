CREATE TYPE "public"."event_lifecycle_state" AS ENUM('draft', 'published', 'live', 'ended', 'archived');--> statement-breakpoint
CREATE TABLE "event_speakers" (
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"regalia" text DEFAULT '' NOT NULL,
	CONSTRAINT "event_speakers_pkey" PRIMARY KEY("event_id","position")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"school" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"specialties" text[] DEFAULT '{}' NOT NULL,
	"partner_ref" text,
	"program_pdf_ref" text,
	"state" "event_lifecycle_state" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;