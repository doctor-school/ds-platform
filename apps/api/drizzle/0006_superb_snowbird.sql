CREATE TYPE "public"."stream_provider" AS ENUM('rutube', 'youtube');--> statement-breakpoint
CREATE TABLE "stream_config" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"provider" "stream_provider" NOT NULL,
	"embed_ref" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stream_config" ADD CONSTRAINT "stream_config_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;