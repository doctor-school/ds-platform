-- ── 048 (#3512): the materials feed, slice 1 (048-design §Data model) ───────
-- `materials` is the retained own-material row; `feed_entries` is the feed,
-- written only by the own-materials feed source in the change's transaction.

CREATE TYPE "public"."feed_entry_kind" AS ENUM('news', 'column');--> statement-breakpoint
CREATE TYPE "public"."feed_source_platform" AS ENUM('academy');--> statement-breakpoint
CREATE TYPE "public"."material_kind" AS ENUM('news', 'column');--> statement-breakpoint
CREATE TYPE "public"."material_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "feed_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_platform" "feed_source_platform" NOT NULL,
	"source_ref" text NOT NULL,
	"material_id" uuid,
	"kind" "feed_entry_kind" NOT NULL,
	"title" text NOT NULL,
	"image_url" text,
	"source_name" text,
	"author_expert_id" uuid,
	"partner_organisation_id" uuid,
	"href" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_entries_title_bounds" CHECK (char_length("feed_entries"."title") BETWEEN 1 AND 160),
	CONSTRAINT "feed_entries_href_bounds" CHECK (char_length("feed_entries"."href") BETWEEN 1 AND 2048),
	CONSTRAINT "feed_entries_academy_has_material" CHECK ("feed_entries"."source_platform" <> 'academy' OR "feed_entries"."material_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "material_kind" NOT NULL,
	"title" text NOT NULL,
	"author_line" text DEFAULT '' NOT NULL,
	"expert_id" uuid,
	"partner_organisation_id" uuid,
	"cover_ref" text,
	"body" jsonb NOT NULL,
	"status" "material_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_slug_pattern" CHECK ("materials"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "materials_slug_not_uuid" CHECK ("materials"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "materials_slug_bounds" CHECK (char_length("materials"."slug") BETWEEN 1 AND 80),
	CONSTRAINT "materials_title_bounds" CHECK (char_length("materials"."title") BETWEEN 1 AND 160),
	CONSTRAINT "materials_author_line_bounds" CHECK (char_length("materials"."author_line") <= 120),
	CONSTRAINT "materials_column_iff_expert" CHECK (("materials"."kind" = 'column') = ("materials"."expert_id" IS NOT NULL)),
	CONSTRAINT "materials_author_line_news_only" CHECK ("materials"."kind" = 'news' OR "materials"."author_line" = ''),
	CONSTRAINT "materials_published_has_first_published_at" CHECK ("materials"."status" <> 'published' OR "materials"."first_published_at" IS NOT NULL),
	CONSTRAINT "materials_version_positive" CHECK ("materials"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_author_expert_id_experts_id_fk" FOREIGN KEY ("author_expert_id") REFERENCES "public"."experts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD CONSTRAINT "feed_entries_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_expert_id_experts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."experts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_entries_source_key" ON "feed_entries" USING btree ("source_platform","source_ref");--> statement-breakpoint
CREATE INDEX "feed_entries_published_at_id_idx" ON "feed_entries" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_entries_author_expert_id_idx" ON "feed_entries" USING btree ("author_expert_id");--> statement-breakpoint
CREATE INDEX "feed_entries_partner_organisation_id_idx" ON "feed_entries" USING btree ("partner_organisation_id");--> statement-breakpoint
CREATE INDEX "feed_entries_material_id_idx" ON "feed_entries" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_slug_key" ON "materials" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "materials_updated_at_idx" ON "materials" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "materials_expert_id_idx" ON "materials" USING btree ("expert_id");--> statement-breakpoint
CREATE INDEX "materials_partner_organisation_id_idx" ON "materials" USING btree ("partner_organisation_id");--> statement-breakpoint
-- EARS-6: first_published_at is set once (012 pattern, the shared 0015 function),
-- so a re-publish restores the card at its first publication instant.
CREATE TRIGGER materials_first_published_at_set_once BEFORE UPDATE ON "materials"
  FOR EACH ROW EXECUTE FUNCTION taxonomy_first_published_at_set_once();--> statement-breakpoint
-- 048-design §Data model: the slug is frozen at the first publish — an invariant
-- of the row, not of one code path.
CREATE OR REPLACE FUNCTION materials_slug_frozen_after_publish()
RETURNS trigger AS $$
BEGIN
  IF OLD.first_published_at IS NOT NULL AND NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'a published material keeps its slug (id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER materials_slug_frozen_after_publish BEFORE UPDATE ON "materials"
  FOR EACH ROW EXECUTE FUNCTION materials_slug_frozen_after_publish();--> statement-breakpoint
-- ── feature-010 audit attachment (048 EARS-8) ──────────────────────────────
CREATE TRIGGER materials_audit AFTER INSERT OR UPDATE OR DELETE
  ON "materials" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER feed_entries_audit AFTER INSERT OR UPDATE OR DELETE
  ON "feed_entries" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
