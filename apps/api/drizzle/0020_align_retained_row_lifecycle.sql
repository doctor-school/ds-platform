-- ── #1278: align the pre-existing 003/005/006/007 tables with the ADR-0003
--    design §3.6 retained-row lifecycle contract. Three moves, one migration:
--
--    1. every application-owned FK becomes ON DELETE RESTRICT (§3.6 rule 4) —
--       the seven cascade paths that could physically erase registrations,
--       presence beats, consent evidence, speakers and stream configs as a side
--       effect of removing a parent row;
--    2. the soft-removable tables gain `record_status` + `deleted_at` and the
--       `retired ⇔ deleted_at IS NOT NULL` CHECK, plus a partial index on the
--       active-row read path (§3.6 rules 1–3);
--    3. `event_speakers` moves its identity off the ordering (below).
--
--    Live-data safety. Every ADD COLUMN carries `DEFAULT 'active' NOT NULL`, so
--    Postgres backfills existing rows to the active state in the same statement
--    — no separate UPDATE pass, and the CHECKs are added AFTER the backfill so
--    they validate an already-consistent table. The FK re-creations revalidate
--    the existing rows, which the cascades had kept referentially intact. The
--    whole file runs in one transaction (drizzle-kit migrate), so the window in
--    which `event_speakers` has no primary key is never visible to a session.
--
--    Tables deliberately NOT touched here: `presence_beats`, `consent_records`
--    and `audit_ledger` are classified immutable/append-only, so they get the
--    RESTRICT foreign keys but NO lifecycle columns — see
--    `packages/db/README.md` → Retained-row classification for the per-table
--    reasoning. `idempotency_keys`, `media_cleanup_jobs`, `event_recordings` and
--    the 012 taxonomy tables already shipped conforming.
CREATE TYPE "public"."record_status" AS ENUM('active', 'retired');--> statement-breakpoint
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "event_speakers" DROP CONSTRAINT "event_speakers_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "stream_config" DROP CONSTRAINT "stream_config_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "presence_beats" DROP CONSTRAINT "presence_beats_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "presence_beats" DROP CONSTRAINT "presence_beats_event_id_events_id_fk";
--> statement-breakpoint
-- ── `event_speakers` identity swap. The old PK was `(event_id, position)`,
--    i.e. the row's identity WAS its ordering — which is why editing a speaker
--    list could only be expressed as DELETE + re-INSERT (a physical delete on
--    every edit, §3.6 rule 1). Dropping the composite PK and adding a stable
--    `id` makes reordering an UPDATE and removal a retirement.
--
--    The new `id` column's DEFAULT is VOLATILE (`gen_random_uuid()`), so
--    Postgres evaluates it per row during the rewrite and every pre-existing
--    speaker gets its own fresh UUID — no collision, no manual backfill.
--
--    `event_speakers_event_position_active_uniq` is PARTIAL
--    (`WHERE record_status = 'active'`) and therefore strictly weaker than the
--    PK it replaces: every existing row is backfilled `active` and was already
--    unique on `(event_id, position)` under the old PK, so the index build below
--    cannot fail on live data. Retired rows are exempt on purpose — they must not
--    squat on a position the live list needs to reuse.
ALTER TABLE "event_speakers" DROP CONSTRAINT "event_speakers_pkey";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "record_status" "record_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "record_status" "record_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "record_status" "record_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stream_config" ADD COLUMN "record_status" "record_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "stream_config" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "record_status" "record_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_config" ADD CONSTRAINT "stream_config_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_beats" ADD CONSTRAINT "presence_beats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_beats" ADD CONSTRAINT "presence_beats_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_active_zitadel_sub_idx" ON "users" USING btree ("zitadel_sub") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "event_speakers_event_position_active_uniq" ON "event_speakers" USING btree ("event_id","position") WHERE "event_speakers"."record_status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "event_speakers_event_id_id_uniq" ON "event_speakers" USING btree ("event_id","id");--> statement-breakpoint
CREATE INDEX "events_active_starts_at_idx" ON "events" USING btree ("starts_at") WHERE "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "registrations_active_event_idx" ON "registrations" USING btree ("event_id") WHERE "registrations"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_retired_iff_deleted" CHECK (("users"."record_status" = 'retired') = ("users"."deleted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_retired_iff_deleted" CHECK (("event_speakers"."record_status" = 'retired') = ("event_speakers"."deleted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_position_non_negative" CHECK ("event_speakers"."position" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_retired_iff_deleted" CHECK (("events"."record_status" = 'retired') = ("events"."deleted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "stream_config" ADD CONSTRAINT "stream_config_retired_iff_deleted" CHECK (("stream_config"."record_status" = 'retired') = ("stream_config"."deleted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_retired_iff_deleted" CHECK (("registrations"."record_status" = 'retired') = ("registrations"."deleted_at" IS NOT NULL));