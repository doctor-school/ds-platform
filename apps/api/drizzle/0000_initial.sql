-- Hand-edited atop drizzle-kit generate output:
-- drizzle-kit does not emit CREATE EXTENSION, so it is prepended manually.
-- Required by ADR-0003 §7 (pgvector in the main Postgres) and DSP-159
-- (dev-stand smoke probe matrix verifies SELECT '[1,2,3]'::vector).
--
-- Regeneration procedure (spec 002 §9): re-run
--   pnpm --filter @ds/api drizzle:generate
-- then re-apply this CREATE EXTENSION header + the statement-breakpoint atop
-- the freshly generated table DDL, and retag drizzle/meta/_journal.json back to
-- "0000_initial". drizzle-kit emits a random tag (e.g. 0000_nice_ezekiel) and
-- never re-emits CREATE EXTENSION, so both edits must be re-done by hand.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
