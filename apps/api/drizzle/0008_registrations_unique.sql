-- 005 EARS-3 — the one-registration invariant (design §2; ADR-0003 §5).
-- Dedup any pre-existing duplicate (user_id, event_id) rows BEFORE adding the
-- uniqueness constraint: EARS-1 shipped the `registrations` table without it, so
-- a plain insert on any DB in flight before this migration could have
-- accumulated duplicates (latent-only in pre-pilot). Keep the EARLIEST
-- `registered_at` (the true first registration), tie-breaking on the lower `id`
-- for a deterministic winner; drop the rest. Without this the ADD CONSTRAINT
-- below would fail on an affected database.
DELETE FROM "registrations" a
  USING "registrations" b
 WHERE a."user_id" = b."user_id"
   AND a."event_id" = b."event_id"
   AND (
     a."registered_at" > b."registered_at"
     OR (a."registered_at" = b."registered_at" AND a."id" > b."id")
   );
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_event_id_unique" UNIQUE("user_id","event_id");