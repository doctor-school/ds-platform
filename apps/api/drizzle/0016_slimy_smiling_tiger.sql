CREATE TABLE "experts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"photo_ref" text,
	"professional_role" text,
	"credentials" text,
	"affiliation" text,
	"bio" text,
	"first_published_at" timestamp with time zone,
	"status" "taxonomy_status" DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"content_removed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experts_retired_iff_deleted" CHECK (("experts"."status" = 'retired') = ("experts"."deleted_at" IS NOT NULL)),
	CONSTRAINT "experts_slug_pattern" CHECK ("experts"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "experts_slug_not_uuid" CHECK ("experts"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "experts_name_bounds" CHECK ("experts"."name" IS NULL OR char_length("experts"."name") BETWEEN 1 AND 160),
	CONSTRAINT "experts_professional_role_bounds" CHECK ("experts"."professional_role" IS NULL OR char_length("experts"."professional_role") BETWEEN 1 AND 160),
	CONSTRAINT "experts_credentials_bounds" CHECK ("experts"."credentials" IS NULL OR char_length("experts"."credentials") BETWEEN 1 AND 500),
	CONSTRAINT "experts_affiliation_bounds" CHECK ("experts"."affiliation" IS NULL OR char_length("experts"."affiliation") BETWEEN 1 AND 240),
	CONSTRAINT "experts_bio_bounds" CHECK ("experts"."bio" IS NULL OR char_length("experts"."bio") BETWEEN 1 AND 4000),
	CONSTRAINT "experts_version_positive" CHECK ("experts"."version" >= 1),
	CONSTRAINT "experts_published_has_first_published_at" CHECK ("experts"."status" <> 'published' OR "experts"."first_published_at" IS NOT NULL),
	CONSTRAINT "experts_name_present_unless_removed" CHECK ("experts"."content_removed_at" IS NOT NULL OR "experts"."name" IS NOT NULL),
	CONSTRAINT "experts_content_removed_shape" CHECK ("experts"."content_removed_at" IS NULL OR (
        "experts"."status" = 'retired'
        AND "experts"."deleted_at" IS NOT NULL
        AND "experts"."name" IS NULL
        AND "experts"."photo_ref" IS NULL
        AND "experts"."professional_role" IS NULL
        AND "experts"."credentials" IS NULL
        AND "experts"."affiliation" IS NULL
        AND "experts"."bio" IS NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "experts_slug_key" ON "experts" USING btree ("slug");
--> statement-breakpoint
-- ── 012-design LD-6 (§2.2 last paragraph): admin expert search is ordinary
--    case-insensitive substring search over `experts.name`/`slug`. The chosen
--    mechanism is `pg_trgm`, so the `ILIKE '%…%'` predicate is served by a GIN
--    index instead of loading the full roster into application code to filter.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "experts_name_trgm_idx" ON "experts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "experts_slug_trgm_idx" ON "experts" USING gin ("slug" gin_trgm_ops);--> statement-breakpoint
-- ── 012 EARS-2 (#1284): feature-010 audit attachment. `experts` is domain
--    truth, so it opts in exactly as `projects` did in 0015; its descriptive
--    columns are ordinary audited text (012-design §6) and contribute no entry
--    to feature-010's masked-column registry.
CREATE TRIGGER experts_audit AFTER INSERT OR UPDATE OR DELETE
  ON "experts" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- ── 012-design §2.1: the same set-once publication instant guard `projects`
--    carries. The function was authored table-agnostically in 0015 (it reads
--    `TG_TABLE_NAME`), so the expert vertical attaches to it rather than
--    defining a second copy that could drift.
CREATE TRIGGER experts_first_published_at_set_once BEFORE UPDATE ON "experts"
  FOR EACH ROW EXECUTE FUNCTION taxonomy_first_published_at_set_once();
