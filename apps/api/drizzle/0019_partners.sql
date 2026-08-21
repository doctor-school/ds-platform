CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"logo_ref" text,
	"website_url" text,
	"first_published_at" timestamp with time zone,
	"status" "taxonomy_status" DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_retired_iff_deleted" CHECK (("partners"."status" = 'retired') = ("partners"."deleted_at" IS NOT NULL)),
	CONSTRAINT "partners_slug_pattern" CHECK ("partners"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "partners_slug_not_uuid" CHECK ("partners"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "partners_title_bounds" CHECK (char_length("partners"."title") BETWEEN 1 AND 160),
	CONSTRAINT "partners_website_url_bounds" CHECK ("partners"."website_url" IS NULL OR char_length("partners"."website_url") BETWEEN 1 AND 2048),
	CONSTRAINT "partners_website_url_https" CHECK ("partners"."website_url" IS NULL OR "partners"."website_url" ~ '^https://[^\s/?#]+[^\s]*$'),
	CONSTRAINT "partners_version_positive" CHECK ("partners"."version" >= 1),
	CONSTRAINT "partners_published_has_first_published_at" CHECK ("partners"."status" <> 'published' OR "partners"."first_published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "partners_slug_key" ON "partners" USING btree ("slug");--> statement-breakpoint
-- ── 012-design §2.2 (last paragraph): admin partner search is ordinary
--    case-insensitive substring search over `partners.title`/`slug`, the same
--    `pg_trgm` mechanism the project, expert and topic verticals use, so the
--    `ILIKE '%…%'` predicate is served by a GIN index instead of loading the
--    full partner roster into application code to filter. The extension was
--    already enabled by 0016; `IF NOT EXISTS` keeps this file independently
--    applicable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "partners_title_trgm_idx" ON "partners" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "partners_slug_trgm_idx" ON "partners" USING gin ("slug" gin_trgm_ops);--> statement-breakpoint
-- ── 012 EARS-4 (#1286): feature-010 audit attachment. `partners` is domain
--    truth, so it opts in exactly as `projects` (0015), `experts` (0016) and
--    `topics` (0017) did; its title and website URL are ordinary audited
--    editorial fields (012-design §6) and contribute no entry to feature-010's
--    masked-column registry.
CREATE TRIGGER partners_audit AFTER INSERT OR UPDATE OR DELETE
  ON "partners" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- ── 012-design §2.1: the same set-once publication instant guard the sibling
--    entities carry. The function is table-agnostic (it reads `TG_TABLE_NAME`),
--    so this vertical attaches to it rather than defining a second copy.
CREATE TRIGGER partners_first_published_at_set_once BEFORE UPDATE ON "partners"
  FOR EACH ROW EXECUTE FUNCTION taxonomy_first_published_at_set_once();