CREATE TYPE "public"."event_participation_format" AS ENUM('online', 'offline', 'hybrid');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "participation_format" "event_participation_format" DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "seats_left" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_seats_left_non_negative" CHECK ("events"."seats_left" >= 0);