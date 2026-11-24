ALTER TABLE "learning_courses" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
-- 024 EARS-30 backfill: a course published now, or one any doctor was ever
-- projected on (it was published then), counts as once published.
UPDATE "learning_courses" SET "first_published_at" = now()
 WHERE "state" = 'published'
    OR EXISTS (SELECT 1 FROM "learning_node_status" s WHERE s."item_id" = "learning_courses"."id");
