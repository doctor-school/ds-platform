CREATE TABLE "specialties_minzdrav" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_other" boolean DEFAULT false NOT NULL,
	"frequent_rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialties_minzdrav_code_format" CHECK ("specialties_minzdrav"."code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("specialties_minzdrav"."code") <= 128),
	CONSTRAINT "specialties_minzdrav_name_nonempty" CHECK (length(btrim("specialties_minzdrav"."name")) > 0 AND length("specialties_minzdrav"."name") <= 256),
	CONSTRAINT "specialties_minzdrav_frequent_rank_positive" CHECK ("specialties_minzdrav"."frequent_rank" IS NULL OR "specialties_minzdrav"."frequent_rank" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "specialties_minzdrav_code_key" ON "specialties_minzdrav" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "specialties_minzdrav_name_key" ON "specialties_minzdrav" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "specialties_minzdrav_is_other_key" ON "specialties_minzdrav" USING btree ("is_other") WHERE "specialties_minzdrav"."is_other";--> statement-breakpoint
CREATE UNIQUE INDEX "specialties_minzdrav_frequent_rank_key" ON "specialties_minzdrav" USING btree ("frequent_rank") WHERE "specialties_minzdrav"."frequent_rank" IS NOT NULL;