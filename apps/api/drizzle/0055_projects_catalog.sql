-- ── 030 EARS-17 / EARS-3 (#3503): the projects catalog absorbs the 012 projects ──
--
-- ONE forward migration, hand-written: the generator offers DROP + ADD for the
-- `kind` → `legacy_kind` rename, which would lose the former 012 kind the admin
-- form still shows as a hint. Every `projects` row keeps its id, slug, status,
-- `first_published_at`, version, cover, description and every event, expert and
-- organisation link; it gets the stage `running` and no results. No result is
-- created from the former kind.
--
-- Runs after 0054 (it needs `project_organisations` and the `investor` seed
-- role of 032). The 010 append-only ledger is not touched (032 precedent).

-- Counts captured before anything moves, for the closing assertion.
CREATE TEMP TABLE "_0055_counts" ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM "projects") AS projects,
         (SELECT count(*) FROM "project_organisations") AS organisations,
         (SELECT count(*) FROM "project_experts") AS experts,
         (SELECT count(*) FROM "event_projects") AS events;--> statement-breakpoint

-- ── the output-kind reference book (EARS-3) ─────────────────────────────────
CREATE TYPE "public"."project_output_kind_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "project_output_kinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" "project_output_kind_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_output_kinds_retired_iff_deleted" CHECK (("project_output_kinds"."status" = 'retired') = ("project_output_kinds"."deleted_at" IS NOT NULL)),
	CONSTRAINT "project_output_kinds_slug_pattern" CHECK ("project_output_kinds"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "project_output_kinds_slug_bounds" CHECK (char_length("project_output_kinds"."slug") BETWEEN 1 AND 80),
	CONSTRAINT "project_output_kinds_title_bounds" CHECK (char_length("project_output_kinds"."title") BETWEEN 1 AND 60),
	CONSTRAINT "project_output_kinds_version_positive" CHECK ("project_output_kinds"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_output_kinds_slug_key" ON "project_output_kinds" USING btree ("slug");--> statement-breakpoint
-- Title unique among ACTIVE kinds, case-insensitively; a retired kind keeps its title.
CREATE UNIQUE INDEX "project_output_kinds_active_title_key" ON "project_output_kinds" USING btree (lower("title")) WHERE "project_output_kinds"."status" = 'active';--> statement-breakpoint
-- The six seed kinds, as ordinary active rows.
INSERT INTO "project_output_kinds" ("id", "slug", "title") VALUES
  ('03000000-0000-4000-8000-000000000001', 'shkola', 'Школа'),
  ('03000000-0000-4000-8000-000000000002', 'kurs', 'Курс'),
  ('03000000-0000-4000-8000-000000000003', 'podkast', 'Подкаст'),
  ('03000000-0000-4000-8000-000000000004', 'sobytie', 'Событие'),
  ('03000000-0000-4000-8000-000000000005', 'kongress', 'Конгресс'),
  ('03000000-0000-4000-8000-000000000006', 'klub', 'Клуб');--> statement-breakpoint

-- ── projects: stage, stage note, display order, legacy kind (EARS-1/5/17) ───
CREATE TYPE "public"."project_stage" AS ENUM('running', 'soon', 'completed');--> statement-breakpoint
-- Backfill default `running`, dropped right after: new rows get `soon` from the
-- service (EARS-1), never from the column.
ALTER TABLE "projects" ADD COLUMN "stage" "project_stage" DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "stage_note" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_stage_note_iff_soon" CHECK (("projects"."stage" = 'soon') = ("projects"."stage_note" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_stage_note_bounds" CHECK ("projects"."stage_note" IS NULL OR char_length("projects"."stage_note") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "display_position" integer;--> statement-breakpoint
-- The backfills below are part of the absorption, not an operator change: the
-- 010 capture triggers are held off around them so the ledger stays untouched.
ALTER TABLE "projects" DISABLE TRIGGER "projects_audit";--> statement-breakpoint
UPDATE "projects" AS p SET "display_position" = o.n
  FROM (SELECT "id", (row_number() OVER (ORDER BY "title", "id")) - 1 AS n
          FROM "projects" WHERE "deleted_at" IS NULL) AS o
 WHERE p."id" = o."id";--> statement-breakpoint
ALTER TABLE "projects" ENABLE TRIGGER "projects_audit";--> statement-breakpoint
-- The former 012 kind survives only as the read-only admin hint.
ALTER TABLE "projects" RENAME COLUMN "kind" TO "legacy_kind";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "legacy_kind" DROP NOT NULL;--> statement-breakpoint

-- ── the ordered result set (EARS-2), empty ──────────────────────────────────
CREATE TABLE "project_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"output_kind_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storefront_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_results_position_nonnegative" CHECK ("project_results"."position" >= 0),
	CONSTRAINT "project_results_title_bounds" CHECK (char_length("project_results"."title") BETWEEN 1 AND 120),
	CONSTRAINT "project_results_description_bounds" CHECK ("project_results"."description" IS NULL OR char_length("project_results"."description") BETWEEN 1 AND 300),
	CONSTRAINT "project_results_storefront_url_https" CHECK ("project_results"."storefront_url" IS NULL OR ("project_results"."storefront_url" ~ '^https://' AND char_length("project_results"."storefront_url") <= 2048))
);
--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_output_kind_id_project_output_kinds_id_fk" FOREIGN KEY ("output_kind_id") REFERENCES "public"."project_output_kinds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_results_project_position_key" ON "project_results" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_results_output_kind_id_idx" ON "project_results" USING btree ("output_kind_id");--> statement-breakpoint

-- ── project_organisations: the per-project role (investor for every link) ───
ALTER TABLE "project_organisations" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "project_organisations" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "project_organisations" DISABLE TRIGGER "project_organisations_audit";--> statement-breakpoint
UPDATE "project_organisations" SET "role_id" = '03200000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "project_organisations" ENABLE TRIGGER "project_organisations_audit";--> statement-breakpoint
ALTER TABLE "project_organisations" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_organisations" ADD CONSTRAINT "project_organisations_role_id_organisation_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."organisation_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_organisations_role_id_idx" ON "project_organisations" USING btree ("role_id");--> statement-breakpoint
ALTER TABLE "project_organisations" ADD CONSTRAINT "project_organisations_note_bounds" CHECK ("project_organisations"."note" IS NULL OR char_length("project_organisations"."note") <= 160);--> statement-breakpoint

-- Abort rather than leave a partially absorbed catalog.
DO $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM "_0055_counts";
  IF (SELECT count(*) FROM "projects") <> c.projects
     OR (SELECT count(*) FROM "projects" WHERE "stage" <> 'running') <> 0
     OR (SELECT count(*) FROM "project_results") <> 0
     OR (SELECT count(*) FROM "project_organisations") <> c.organisations
     OR (SELECT count(*) FROM "project_experts") <> c.experts
     OR (SELECT count(*) FROM "event_projects") <> c.events
     OR (SELECT count(*) FROM "project_output_kinds" WHERE "status" = 'active') <> 6 THEN
    RAISE EXCEPTION 'projects catalog absorption mismatch'
      USING DETAIL = format('projects=%s links=%s', c.projects, c.organisations);
  END IF;
END $$;--> statement-breakpoint

-- ── feature-010 audit attachment (EARS-18) ──────────────────────────────────
-- Attached after the seed inserts, so the migration itself writes no ledger rows.
CREATE TRIGGER project_output_kinds_audit AFTER INSERT OR UPDATE OR DELETE
  ON "project_output_kinds" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER project_results_audit AFTER INSERT OR UPDATE OR DELETE
  ON "project_results" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
