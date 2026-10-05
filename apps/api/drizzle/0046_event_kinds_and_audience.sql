-- 012 LD-11 / LD-12, EARS-25…EARS-30 (Issue #2509) — the open event-kind
-- dictionary, the event audience and the project default audience.
--
-- Order: the dictionary and its five seed kinds first (EARS-27, on every
-- database — they are ordinary published rows, not code constants); then the
-- three columns as NULLABLE; then the reviewed row-by-row mapping (LD-12) that
-- fills them; then NOT NULL + the foreign key. The mapping is INLINE by design,
-- the same fail-closed shape as 0028 (LD-10): it is the production inventory
-- read on 2026-10-05 and reviewed by the Product Lead on #2509
-- (issuecomment-5994702215). Any retained event or project outside it aborts the
-- migration for explicit per-row review; there is no heuristic fallback and no
-- default for an event without a project. An id of the mapping absent from the
-- database is not an error (dev stands and CI hold none of them).
CREATE TYPE "public"."event_audience" AS ENUM('doctors', 'experts');--> statement-breakpoint
CREATE TABLE "event_kinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"allowed_formats" "event_participation_format"[] NOT NULL,
	"first_published_at" timestamp with time zone,
	"status" "taxonomy_status" DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_kinds_retired_iff_deleted" CHECK (("event_kinds"."status" = 'retired') = ("event_kinds"."deleted_at" IS NOT NULL)),
	CONSTRAINT "event_kinds_slug_pattern" CHECK ("event_kinds"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_kinds_slug_not_uuid" CHECK ("event_kinds"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "event_kinds_slug_bounds" CHECK (char_length("event_kinds"."slug") BETWEEN 1 AND 80),
	CONSTRAINT "event_kinds_title_bounds" CHECK (char_length("event_kinds"."title") BETWEEN 1 AND 120),
	CONSTRAINT "event_kinds_allowed_formats_non_empty" CHECK (cardinality("event_kinds"."allowed_formats") BETWEEN 1 AND 3),
	CONSTRAINT "event_kinds_version_positive" CHECK ("event_kinds"."version" >= 1),
	CONSTRAINT "event_kinds_published_has_first_published_at" CHECK ("event_kinds"."status" <> 'published' OR "event_kinds"."first_published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_kinds_slug_key" ON "event_kinds" USING btree ("slug");--> statement-breakpoint
-- ── feature-010 audit attachment: `event_kinds` is editorial domain truth, so it
--    opts in exactly as `directions` did (0026).
CREATE TRIGGER event_kinds_audit AFTER INSERT OR UPDATE OR DELETE
  ON "event_kinds" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
-- ── 012-design §2.1: the set-once publication instant guard every taxonomy
--    entity carries (the function is table-agnostic).
CREATE TRIGGER event_kinds_first_published_at_set_once BEFORE UPDATE ON "event_kinds"
  FOR EACH ROW EXECUTE FUNCTION taxonomy_first_published_at_set_once();--> statement-breakpoint
-- ── EARS-27: exactly the five seed kinds of LD-11, published.
INSERT INTO "event_kinds" ("slug", "title", "allowed_formats", "status", "first_published_at")
VALUES
  ('vebinar', 'Вебинар', ARRAY['online']::"event_participation_format"[], 'published', now()),
  ('efir', 'Эфир', ARRAY['online']::"event_participation_format"[], 'published', now()),
  ('kongress', 'Конгресс', ARRAY['offline', 'hybrid']::"event_participation_format"[], 'published', now()),
  ('vstrecha-kluba', 'Встреча клуба', ARRAY['online', 'offline', 'hybrid']::"event_participation_format"[], 'published', now()),
  ('master-klass', 'Мастер-класс', ARRAY['offline', 'hybrid']::"event_participation_format"[], 'published', now());--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "kind_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "audience" "event_audience";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_audience" "event_audience";--> statement-breakpoint
-- ── LD-12: the reviewed row-by-row mapping.
DO $$
DECLARE
  -- The Product Lead's mapping, 2026-10-05 (#2509 issuecomment-5994702215).
  c_orthobio constant uuid := 'eae866f8-03d6-4fcf-8900-c64b257ec4c0';
  c_smysly_events constant uuid[] := ARRAY[
    '6d28a44d-5de1-406a-9c6d-127d29547c0d', '641a1b9a-e575-413f-bba4-38038fb70648',
    'df5576b2-5dc4-4fd1-949a-ec23d2ce6e85', 'aa4e8980-3085-4eb5-b7bf-765dfd8c13a0',
    '890df0a2-e93d-46eb-9155-6ed90bc400d0', '53589cb2-8151-476f-b78e-60ddf56a0f99',
    '8cd68379-a508-4235-9dc9-4021945de07f', 'c7b373e5-af07-4b45-8986-b7d2da404144'
  ]::uuid[];
  c_orthobio_webinar constant uuid := '308db4c9-6e4f-45ef-b00b-4685751c8846';
  c_orthobio_congress constant uuid := 'f637ce37-02e3-4fb8-ae88-56f782729632';
  -- Test rows the owner ordered deleted with this change.
  c_deleted_events constant uuid[] := ARRAY[
    'a821f7a3-18f5-411f-a9ab-ce03783722f1', '27d0a2d4-1361-468e-a2f8-bbeb1d51226a',
    'c3f1afb8-5e38-4c06-9fa6-63bb127a3743', 'a90819b1-d447-418e-a292-720ed2c4c58d',
    '95de5595-1e4d-4003-b9c2-4c579470ce44'
  ]::uuid[];
  v_unmapped text;
  v_smysly uuid;
BEGIN
  -- 1. Fail closed BEFORE any write: every project and every event is mapped.
  SELECT string_agg("id"::text, ', ' ORDER BY "id") INTO v_unmapped
    FROM "projects" WHERE "id" <> c_orthobio;
  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = '012 LD-12: projects outside the reviewed audience mapping: ' || v_unmapped;
  END IF;
  SELECT string_agg("id"::text, ', ' ORDER BY "id") INTO v_unmapped
    FROM "events"
   WHERE NOT ("id" = ANY (c_smysly_events || c_deleted_events
                          || ARRAY[c_orthobio_webinar, c_orthobio_congress]));
  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = '012 LD-12: events outside the reviewed kind/audience mapping: ' || v_unmapped;
  END IF;

  -- 2. Delete the five test events with every child row. Each foreign key into
  --    `events` (and into their `registrations`) is ON DELETE RESTRICT, so the
  --    children go first, explicitly, leaf to root; a child table this list
  --    misses makes the final DELETE fail rather than leave an orphan.
  DELETE FROM "registration_attendance" WHERE "registration_id" IN (
    SELECT "id" FROM "registrations" WHERE "event_id" = ANY (c_deleted_events));
  DELETE FROM "congress_submissions" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "congress_submission_kind_settings" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "congress_submission_settings" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "presence_beats" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "registrations" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "event_role_grants" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "event_recordings" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "stream_config" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "event_experts" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "event_projects" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "event_directions" WHERE "event_id" = ANY (c_deleted_events);
  DELETE FROM "events" WHERE "id" = ANY (c_deleted_events);

  -- 3. Project default audiences.
  UPDATE "projects" SET "default_audience" = 'doctors' WHERE "id" = c_orthobio;

  -- 4. «Академия смыслов» — created only where its events exist (production),
  --    as a draft like Orthobio School: neither public read needs a published
  --    project, and an editor completes and publishes it in the admin.
  IF EXISTS (SELECT 1 FROM "events" WHERE "id" = ANY (c_smysly_events)) THEN
    INSERT INTO "projects" ("slug", "kind", "title", "default_audience", "status")
    VALUES ('akademiya-smyslov', 'media', 'Академия смыслов', 'experts', 'draft')
    RETURNING "id" INTO v_smysly;
    INSERT INTO "event_projects" ("event_id", "project_id")
    SELECT "id", v_smysly FROM "events" WHERE "id" = ANY (c_smysly_events);
  END IF;

  -- 5. Event kind + audience.
  UPDATE "events" e
     SET "audience" = m."audience"::"event_audience",
         "kind_id" = k."id"
    FROM (VALUES
      ('6d28a44d-5de1-406a-9c6d-127d29547c0d'::uuid, 'experts', 'efir'),
      ('641a1b9a-e575-413f-bba4-38038fb70648'::uuid, 'experts', 'efir'),
      ('df5576b2-5dc4-4fd1-949a-ec23d2ce6e85'::uuid, 'experts', 'efir'),
      ('aa4e8980-3085-4eb5-b7bf-765dfd8c13a0'::uuid, 'experts', 'efir'),
      ('890df0a2-e93d-46eb-9155-6ed90bc400d0'::uuid, 'experts', 'efir'),
      ('53589cb2-8151-476f-b78e-60ddf56a0f99'::uuid, 'experts', 'efir'),
      ('8cd68379-a508-4235-9dc9-4021945de07f'::uuid, 'experts', 'efir'),
      ('c7b373e5-af07-4b45-8986-b7d2da404144'::uuid, 'experts', 'efir'),
      ('308db4c9-6e4f-45ef-b00b-4685751c8846'::uuid, 'doctors', 'vebinar'),
      ('f637ce37-02e3-4fb8-ae88-56f782729632'::uuid, 'doctors', 'kongress')
    ) AS m("id", "audience", "kind_slug")
    JOIN "event_kinds" k ON k."slug" = m."kind_slug"
   WHERE e."id" = m."id";

  -- 6. LD-11: the mapping never assigns a kind that disallows the row's format.
  SELECT string_agg(e."id"::text, ', ' ORDER BY e."id") INTO v_unmapped
    FROM "events" e JOIN "event_kinds" k ON k."id" = e."kind_id"
   WHERE NOT (e."participation_format" = ANY (k."allowed_formats"));
  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = '012 LD-11: mapped kind disallows the event format: ' || v_unmapped;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "kind_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "audience" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "default_audience" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_kind_id_event_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."event_kinds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_kind_id_idx" ON "events" USING btree ("kind_id");
