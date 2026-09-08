-- 012 §LD-10 / Issue #1607 — the reviewed per-id name mapping is INLINE, by design.
-- Existing Expert names are reviewed data, not parsed input: splitting legacy `name`
-- into family/given/patronymic by any parser is forbidden. The list below is the
-- production inventory reviewed on 2026-09-08 (every retained non-content-removed
-- row); a mapping id absent from the table is fine (dev stands and CI have none),
-- but a retained row NOT in the list fails the migration closed before any schema
-- mutation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "experts"
    WHERE "content_removed_at" IS NULL
      -- The same two ids the mapping UPDATE below carries.
      AND "id" NOT IN (
        '7d2d7708-e23b-43fa-bd2d-dce1b907ba5f'::uuid,
        '15957c9b-3715-4daf-a2d1-437b4d9255c9'::uuid
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'EARS-20: experts structured-name migration requires an explicit reviewed per-id mapping';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "experts" DROP CONSTRAINT "experts_name_bounds";--> statement-breakpoint
ALTER TABLE "experts" DROP CONSTRAINT "experts_name_present_unless_removed";--> statement-breakpoint
ALTER TABLE "experts" DROP CONSTRAINT "experts_content_removed_shape";--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "family_name" text;--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "given_name" text;--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "patronymic" text;--> statement-breakpoint
ALTER TABLE "experts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE INDEX "experts_family_name_trgm_idx" ON "experts" USING gin ("family_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "experts_given_name_trgm_idx" ON "experts" USING gin ("given_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "experts_patronymic_trgm_idx" ON "experts" USING gin ("patronymic" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experts_user_id_key" ON "experts" USING btree ("user_id");--> statement-breakpoint
UPDATE "experts" AS e
SET "family_name" = m."family_name",
    "given_name" = m."given_name",
    "patronymic" = m."patronymic"
FROM (VALUES
  ('7d2d7708-e23b-43fa-bd2d-dce1b907ba5f'::uuid, 'Ильдарханов', 'Эдуард', 'Габдулгазизович'),
  ('15957c9b-3715-4daf-a2d1-437b4d9255c9'::uuid, 'Загородний', 'Николай', 'Васильевич')
) AS m("id", "family_name", "given_name", "patronymic")
WHERE e."id" = m."id";--> statement-breakpoint
ALTER TABLE "experts" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_family_name_bounds" CHECK ("experts"."family_name" IS NULL OR char_length("experts"."family_name") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_given_name_bounds" CHECK ("experts"."given_name" IS NULL OR char_length("experts"."given_name") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_patronymic_bounds" CHECK ("experts"."patronymic" IS NULL OR char_length("experts"."patronymic") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_structured_name_present_unless_removed" CHECK ("experts"."content_removed_at" IS NOT NULL OR ("experts"."family_name" IS NOT NULL AND "experts"."given_name" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_content_removed_shape" CHECK ("experts"."content_removed_at" IS NULL OR (
        "experts"."status" = 'retired'
        AND "experts"."deleted_at" IS NOT NULL
        AND "experts"."family_name" IS NULL
        AND "experts"."given_name" IS NULL
        AND "experts"."patronymic" IS NULL
        AND "experts"."photo_ref" IS NULL
        AND "experts"."professional_role" IS NULL
        AND "experts"."credentials" IS NULL
        AND "experts"."affiliation" IS NULL
        AND "experts"."bio" IS NULL
      ));
