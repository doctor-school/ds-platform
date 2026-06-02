-- Hand-edited atop drizzle-kit generate output:
-- drizzle-kit does not emit CREATE EXTENSION, so it is prepended manually.
-- `users.email` is the `citext` (case-insensitive text) type — required for the
-- case-insensitive email uniqueness in 003-design §5 / ADR-0001 §3.
--
-- Regeneration procedure (spec 002 §9): re-run
--   pnpm --filter @ds/api drizzle:generate
-- then re-apply this CREATE EXTENSION header + the statement-breakpoint atop the
-- freshly generated DDL. drizzle-kit never re-emits CREATE EXTENSION, so this
-- edit must be re-done by hand on every regeneration of this file.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zitadel_sub" text NOT NULL,
	"email" "citext",
	"phone" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'doctor_guest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_zitadel_sub_unique" UNIQUE("zitadel_sub"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_or_phone" CHECK ("users"."email" IS NOT NULL OR "users"."phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"version" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;