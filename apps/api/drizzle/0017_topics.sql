CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"first_published_at" timestamp with time zone,
	"status" "taxonomy_status" DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_retired_iff_deleted" CHECK (("topics"."status" = 'retired') = ("topics"."deleted_at" IS NOT NULL)),
	CONSTRAINT "topics_slug_pattern" CHECK ("topics"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "topics_slug_not_uuid" CHECK ("topics"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "topics_title_bounds" CHECK (char_length("topics"."title") BETWEEN 1 AND 120),
	CONSTRAINT "topics_version_positive" CHECK ("topics"."version" >= 1),
	CONSTRAINT "topics_published_has_first_published_at" CHECK ("topics"."status" <> 'published' OR "topics"."first_published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "topics_slug_key" ON "topics" USING btree ("slug");
--> statement-breakpoint
-- ── 012-design LD-6 (§2.2 last paragraph): admin topic search is ordinary
--    case-insensitive substring search over `topics.title`/`slug`. Same
--    `pg_trgm` mechanism the project and expert verticals use, so the
--    `ILIKE '%…%'` predicate is served by a GIN index instead of loading the
--    full topic roster into application code to filter. The extension was
--    already enabled by 0016; `IF NOT EXISTS` keeps this file independently
--    applicable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "topics_title_trgm_idx" ON "topics" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "topics_slug_trgm_idx" ON "topics" USING gin ("slug" gin_trgm_ops);--> statement-breakpoint
-- ── 012 EARS-3 (#1285): feature-010 audit attachment. `topics` is domain truth,
--    so it opts in exactly as `projects` (0015) and `experts` (0016) did; its
--    title is ordinary audited editorial text (012-design §6) and contributes no
--    entry to feature-010's masked-column registry.
CREATE TRIGGER topics_audit AFTER INSERT OR UPDATE OR DELETE
  ON "topics" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- ── 012-design §2.1: the same set-once publication instant guard the sibling
--    entities carry. The function is table-agnostic (it reads `TG_TABLE_NAME`),
--    so this vertical attaches to it rather than defining a second copy.
CREATE TRIGGER topics_first_published_at_set_once BEFORE UPDATE ON "topics"
  FOR EACH ROW EXECUTE FUNCTION taxonomy_first_published_at_set_once();
