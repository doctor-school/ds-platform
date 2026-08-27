-- ── ADR-0016 §5: `topics` → `directions`, the one shipped-surface rename ─────
--
-- This is a TRUE RENAME, hand-written over the drizzle-kit diff: the generator
-- offers only DROP + CREATE for a renamed table, which would destroy every
-- retained row and re-issue new ids for identities the public URLs, the audit
-- ledger and (from #1484) the doctor's targeting already cite. ADR-0016 §5 is
-- explicit that the rename "is its own migration slice preserving the
-- retained-row lifecycle (#1278)", so the row, its id, its slug and its version
-- all survive untouched and only the NAMES move.
--
-- Every dependent object is renamed with the table: Postgres does not cascade a
-- table rename into its constraints, indexes or triggers, so a mechanical
-- `ALTER TABLE … RENAME` alone would leave `topics_slug_key` guarding a table
-- called `directions` — and the next drizzle diff would then try to "fix" it by
-- dropping and re-creating the index.
ALTER TABLE "topics" RENAME TO "directions";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_retired_iff_deleted" TO "directions_retired_iff_deleted";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_slug_pattern" TO "directions_slug_pattern";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_slug_not_uuid" TO "directions_slug_not_uuid";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_title_bounds" TO "directions_title_bounds";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_version_positive" TO "directions_version_positive";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_published_has_first_published_at" TO "directions_published_has_first_published_at";--> statement-breakpoint
ALTER TABLE "directions" RENAME CONSTRAINT "topics_pkey" TO "directions_pkey";--> statement-breakpoint
ALTER INDEX "topics_slug_key" RENAME TO "directions_slug_key";--> statement-breakpoint
-- LD-6 trigram search indexes (0017) follow the table, unchanged in shape.
ALTER INDEX "topics_title_trgm_idx" RENAME TO "directions_title_trgm_idx";--> statement-breakpoint
ALTER INDEX "topics_slug_trgm_idx" RENAME TO "directions_slug_trgm_idx";--> statement-breakpoint
-- Both feature-010 / 012-design §2.1 triggers are table-agnostic functions
-- (`TG_TABLE_NAME`), so only the trigger names move; the attachment survives.
-- `topics_audit` is re-created as `directions_audit` at the tail of this file
-- (explicit CREATE for the audit-coverage guard); only the publish-once trigger
-- is renamed in place.
ALTER TRIGGER "topics_first_published_at_set_once" ON "directions" RENAME TO "directions_first_published_at_set_once";--> statement-breakpoint

-- ── ADR-0016 §2.8: the two direction reference relations (new) ───────────────
CREATE TABLE "direction_adjacency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction_id" uuid NOT NULL,
	"adjacent_direction_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"weight" integer NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direction_adjacency_no_self_edge" CHECK ("direction_adjacency"."direction_id" <> "direction_adjacency"."adjacent_direction_id"),
	CONSTRAINT "direction_adjacency_kind_shape" CHECK ("direction_adjacency"."kind" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("direction_adjacency"."kind") <= 64),
	CONSTRAINT "direction_adjacency_weight_bounds" CHECK ("direction_adjacency"."weight" BETWEEN 1 AND 100),
	CONSTRAINT "direction_adjacency_retired_iff_deleted" CHECK (("direction_adjacency"."status" = 'retired') = ("direction_adjacency"."deleted_at" IS NOT NULL)),
	CONSTRAINT "direction_adjacency_version_positive" CHECK ("direction_adjacency"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "direction_specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction_id" uuid NOT NULL,
	"specialty_minzdrav_id" uuid NOT NULL,
	"status" "relationship_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direction_specialties_retired_iff_deleted" CHECK (("direction_specialties"."status" = 'retired') = ("direction_specialties"."deleted_at" IS NOT NULL)),
	CONSTRAINT "direction_specialties_version_positive" CHECK ("direction_specialties"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "direction_adjacency" ADD CONSTRAINT "direction_adjacency_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction_adjacency" ADD CONSTRAINT "direction_adjacency_adjacent_direction_id_directions_id_fk" FOREIGN KEY ("adjacent_direction_id") REFERENCES "public"."directions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction_specialties" ADD CONSTRAINT "direction_specialties_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction_specialties" ADD CONSTRAINT "direction_specialties_specialty_minzdrav_id_specialties_minzdrav_id_fk" FOREIGN KEY ("specialty_minzdrav_id") REFERENCES "public"."specialties_minzdrav"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "direction_adjacency_pair_key" ON "direction_adjacency" USING btree ("direction_id","adjacent_direction_id");--> statement-breakpoint
CREATE INDEX "direction_adjacency_adjacent_id_idx" ON "direction_adjacency" USING btree ("adjacent_direction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direction_specialties_pair_key" ON "direction_specialties" USING btree ("direction_id","specialty_minzdrav_id");--> statement-breakpoint
CREATE INDEX "direction_specialties_specialty_id_idx" ON "direction_specialties" USING btree ("specialty_minzdrav_id");--> statement-breakpoint
-- ── feature-010 audit attachment. Both relations are domain truth — which
--    specialties a direction serves and which directions are adjacent decides
--    what a doctor is shown (017 EARS-8) — so each opts in exactly as
--    `event_projects` (0022) did, and the audit-coverage guard would turn CI red
--    if either trigger were missing.
CREATE TRIGGER direction_specialties_audit AFTER INSERT OR UPDATE OR DELETE
  ON "direction_specialties" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER direction_adjacency_audit AFTER INSERT OR UPDATE OR DELETE
  ON "direction_adjacency" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- The table rename above carries the old `topics_audit` trigger over to the
-- renamed table; re-create it under the renamed name so the audit attachment
-- for `directions` is explicit in the migration text (audit-coverage guard).
DROP TRIGGER IF EXISTS "topics_audit" ON "directions";--> statement-breakpoint
CREATE TRIGGER directions_audit AFTER INSERT OR UPDATE OR DELETE
  ON "directions" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
