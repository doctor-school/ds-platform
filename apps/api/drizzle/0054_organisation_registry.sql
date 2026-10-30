-- ── 032 EARS-11 / EARS-3 (#3492): the organisation registry absorbs 012's partners ──
--
-- A TRUE RENAME, hand-written (the 0026 topics → directions pattern): the
-- generator offers only DROP + CREATE for a renamed table, which would destroy
-- every retained partner and re-issue new ids for identities the public partner
-- URLs, the project links and the audit ledger already cite. Renaming keeps
-- every id, slug, title, logo, website, lifecycle state, `first_published_at`,
-- version and timestamp by construction, and every `project_organisations`
-- foreign key with them.
--
-- Postgres does not cascade a table rename into constraint, index or trigger
-- NAMES, so each dependent object is renamed explicitly; otherwise the next
-- drizzle diff would try to "fix" them by drop + re-create.
--
-- The 010 audit ledger is append-only: no ledger row is touched. The former
-- partners' rows keep their `data.partners.*` event type, and the history read
-- finds one organisation by its unchanged id under both entity names.
--
-- Kept as stored identifiers (lead decision, 032-design §Absorbing migration):
-- the `media_entity_kind` value `partner` and the `partner` slug base.

-- Counts captured before anything moves, for the closing assertion.
CREATE TEMP TABLE "_0054_counts" ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM "partners") AS partners,
         (SELECT count(*) FROM "project_partners") AS links;--> statement-breakpoint

-- ── the role reference book (EARS-3) ────────────────────────────────────────
CREATE TYPE "public"."organisation_role_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "organisation_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" "organisation_role_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_roles_retired_iff_deleted" CHECK (("organisation_roles"."status" = 'retired') = ("organisation_roles"."deleted_at" IS NOT NULL)),
	CONSTRAINT "organisation_roles_slug_pattern" CHECK ("organisation_roles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "organisation_roles_slug_bounds" CHECK (char_length("organisation_roles"."slug") BETWEEN 1 AND 80),
	CONSTRAINT "organisation_roles_title_bounds" CHECK (char_length("organisation_roles"."title") BETWEEN 1 AND 80),
	CONSTRAINT "organisation_roles_version_positive" CHECK ("organisation_roles"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_roles_slug_key" ON "organisation_roles" USING btree ("slug");--> statement-breakpoint
-- Title unique among ACTIVE roles, case-insensitively; a retired role keeps its title.
CREATE UNIQUE INDEX "organisation_roles_active_title_key" ON "organisation_roles" USING btree (lower("title")) WHERE "organisation_roles"."status" = 'active';--> statement-breakpoint
-- Exactly three seed roles, as ordinary rows (no employer / sponsor / advertiser role).
INSERT INTO "organisation_roles" ("id", "slug", "title") VALUES
  ('03200000-0000-4000-8000-000000000001', 'investor', 'Инвестор'),
  ('03200000-0000-4000-8000-000000000002', 'clinical-base', 'Клиническая площадка'),
  ('03200000-0000-4000-8000-000000000003', 'educational-licensee', 'Образовательный лицензиат');--> statement-breakpoint

-- ── partners → organisations ────────────────────────────────────────────────
ALTER TABLE "partners" RENAME TO "organisations";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_pkey" TO "organisations_pkey";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_published_has_first_published_at" TO "organisations_published_has_first_published_at";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_retired_iff_deleted" TO "organisations_retired_iff_deleted";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_slug_bounds" TO "organisations_slug_bounds";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_slug_not_uuid" TO "organisations_slug_not_uuid";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_slug_pattern" TO "organisations_slug_pattern";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_title_bounds" TO "organisations_title_bounds";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_version_positive" TO "organisations_version_positive";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_website_url_bounds" TO "organisations_website_url_bounds";--> statement-breakpoint
ALTER TABLE "organisations" RENAME CONSTRAINT "partners_website_url_https" TO "organisations_website_url_https";--> statement-breakpoint
ALTER INDEX "partners_slug_key" RENAME TO "organisations_slug_key";--> statement-breakpoint
ALTER INDEX "partners_title_trgm_idx" RENAME TO "organisations_title_trgm_idx";--> statement-breakpoint
ALTER INDEX "partners_slug_trgm_idx" RENAME TO "organisations_slug_trgm_idx";--> statement-breakpoint
ALTER TRIGGER "partners_first_published_at_set_once" ON "organisations" RENAME TO "organisations_first_published_at_set_once";--> statement-breakpoint
-- EARS-1: description and the two display rules. Both rules start ON: every
-- absorbed partner was publicly shown, so nothing a visitor sees changes.
ALTER TABLE "organisations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "public_name_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "public_logo_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_description_bounds" CHECK ("organisations"."description" IS NULL OR char_length("organisations"."description") <= 1000);--> statement-breakpoint

-- ── project_partners → project_organisations ────────────────────────────────
ALTER TABLE "project_partners" RENAME TO "project_organisations";--> statement-breakpoint
ALTER TABLE "project_organisations" RENAME COLUMN "partner_id" TO "organisation_id";--> statement-breakpoint
ALTER TABLE "project_organisations" RENAME CONSTRAINT "project_partners_pkey" TO "project_organisations_pkey";--> statement-breakpoint
ALTER TABLE "project_organisations" RENAME CONSTRAINT "project_partners_retired_iff_deleted" TO "project_organisations_retired_iff_deleted";--> statement-breakpoint
ALTER TABLE "project_organisations" RENAME CONSTRAINT "project_partners_version_positive" TO "project_organisations_version_positive";--> statement-breakpoint
ALTER TABLE "project_organisations" RENAME CONSTRAINT "project_partners_project_id_projects_id_fk" TO "project_organisations_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_organisations" RENAME CONSTRAINT "project_partners_partner_id_partners_id_fk" TO "project_organisations_organisation_id_organisations_id_fk";--> statement-breakpoint
ALTER INDEX "project_partners_pair_key" RENAME TO "project_organisations_pair_key";--> statement-breakpoint
ALTER INDEX "project_partners_project_primary_active_uniq" RENAME TO "project_organisations_project_primary_active_uniq";--> statement-breakpoint
ALTER INDEX "project_partners_partner_id_idx" RENAME TO "project_organisations_organisation_id_idx";--> statement-breakpoint

-- ── the role set (EARS-2) and the investor role of every absorbed partner ───
CREATE TABLE "organisation_role_assignments" (
	"organisation_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_role_assignments_organisation_id_role_id_pk" PRIMARY KEY("organisation_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "organisation_role_assignments" ADD CONSTRAINT "organisation_role_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_role_assignments" ADD CONSTRAINT "organisation_role_assignments_role_id_organisation_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."organisation_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_role_assignments_role_id_idx" ON "organisation_role_assignments" USING btree ("role_id");--> statement-breakpoint
INSERT INTO "organisation_role_assignments" ("organisation_id", "role_id")
  SELECT "id", '03200000-0000-4000-8000-000000000001' FROM "organisations";--> statement-breakpoint

-- Abort rather than leave a partially absorbed registry.
DO $$
DECLARE
  expected_partners bigint;
  expected_links bigint;
BEGIN
  SELECT partners, links INTO expected_partners, expected_links FROM "_0054_counts";
  IF (SELECT count(*) FROM "organisations") <> expected_partners
     OR (SELECT count(*) FROM "organisation_role_assignments") <> expected_partners
     OR (SELECT count(*) FROM "project_organisations") <> expected_links THEN
    RAISE EXCEPTION 'organisation registry absorption mismatch'
      USING DETAIL = format('partners=%s links=%s', expected_partners, expected_links);
  END IF;
END $$;--> statement-breakpoint

-- ── feature-010 audit attachment (EARS-13) ──────────────────────────────────
-- The renames carried `partners_audit` / `project_partners_audit` over to the
-- renamed tables; re-create them under the new names so the attachment is
-- explicit in the migration text (audit-coverage guard, 0026 pattern). The two
-- new tables opt in: who changed an organisation's roles, or a role, is
-- precisely what the ledger answers. Attached after the seed inserts, so the
-- migration itself writes no ledger rows.
DROP TRIGGER IF EXISTS "partners_audit" ON "organisations";--> statement-breakpoint
CREATE TRIGGER organisations_audit AFTER INSERT OR UPDATE OR DELETE
  ON "organisations" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
DROP TRIGGER IF EXISTS "project_partners_audit" ON "project_organisations";--> statement-breakpoint
CREATE TRIGGER project_organisations_audit AFTER INSERT OR UPDATE OR DELETE
  ON "project_organisations" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER organisation_roles_audit AFTER INSERT OR UPDATE OR DELETE
  ON "organisation_roles" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER organisation_role_assignments_audit AFTER INSERT OR UPDATE OR DELETE
  ON "organisation_role_assignments" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
