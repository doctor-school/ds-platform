ALTER TABLE "applications" DROP CONSTRAINT "applications_kind_check";--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_team_notice_check";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_kind_check" CHECK ("applications"."kind" IN ('author', 'partnership'));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_team_notice_check" CHECK ("applications"."team_notice" IN ('pending', 'sent', 'failed', 'skipped', 'imported'));