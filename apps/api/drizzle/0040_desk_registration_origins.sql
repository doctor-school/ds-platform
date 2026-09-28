-- 044 EARS-35 (#2382): the desk-registration origins (044-design §Data model).
--
-- `consent_records.origin` — nullable: `paper` for a consent the registrar
-- recorded from a paper form at the desk, NULL for every online consent (all
-- existing rows). The table stays append-only; purpose/version are unchanged.
ALTER TABLE "consent_records" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_origin_check" CHECK ("consent_records"."origin" IS NULL OR "consent_records"."origin" = 'paper');--> statement-breakpoint
-- `registrations.intake_origin` — the design's fixed order: add NULLABLE, then
-- backfill (`site` where `answers IS NOT NULL` — only the congress-site intake
-- has ever written answers — and `platform` for every remaining row), and only
-- then set the default and NOT NULL. A one-step `ADD COLUMN ... DEFAULT
-- 'platform' NOT NULL` would stamp every live site registration `platform`.
-- The backfill runs outside an API request, so the 010 trigger records it as
-- `db-direct`.
ALTER TABLE "registrations" ADD COLUMN "intake_origin" text;--> statement-breakpoint
UPDATE "registrations" SET "intake_origin" = CASE WHEN "answers" IS NOT NULL THEN 'site' ELSE 'platform' END WHERE "intake_origin" IS NULL;--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "intake_origin" SET DEFAULT 'platform';--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "intake_origin" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_intake_origin_check" CHECK ("registrations"."intake_origin" IN ('site', 'desk', 'platform'));
