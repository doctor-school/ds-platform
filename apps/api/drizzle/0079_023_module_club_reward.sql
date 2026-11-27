ALTER TABLE "learning_modules" ADD COLUMN "club_event_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_modules" ADD CONSTRAINT "learning_modules_club_event_id_events_id_fk" FOREIGN KEY ("club_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 023 EARS-2 — the `module.reward` setting's platform seed (`points`), the value
-- LEARNING_PLATFORM_SEED of packages/learning/src/rules/seed.ts holds (an api
-- e2e pins the platform row = that constant). Every other key of the row stays.
UPDATE "learning_rule_layers"
SET "values" = "values" || '{"module.reward":"points"}'::jsonb,
	"version" = "version" + 1,
	"updated_at" = now()
WHERE "scope_kind" = 'platform' AND "scope_id" = 'platform' AND NOT ("values" ? 'module.reward');
