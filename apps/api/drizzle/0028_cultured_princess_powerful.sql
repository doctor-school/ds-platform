DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "experts"
    WHERE "content_removed_at" IS NULL
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
