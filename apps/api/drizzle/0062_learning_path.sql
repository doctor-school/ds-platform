CREATE TYPE "public"."learning_state" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "learning_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"question_ids" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "learning_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"state" "learning_state" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "learning_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"step_id" uuid,
	"item_ref" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_facts_person_event_key" UNIQUE("person_id","event_id"),
	CONSTRAINT "learning_facts_source" CHECK ("learning_facts"."source" IN ('web', 'app', 'system'))
);
--> statement-breakpoint
CREATE TABLE "learning_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_lesson_ratings" (
	"person_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"stars" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_lesson_ratings_person_id_lesson_id_pk" PRIMARY KEY("person_id","lesson_id"),
	CONSTRAINT "learning_lesson_ratings_stars" CHECK ("learning_lesson_ratings"."stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "learning_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"teaser" text DEFAULT '' NOT NULL,
	"state" "learning_state" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_node_status" (
	"person_id" uuid NOT NULL,
	"item_kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"status" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"cause_kind" text NOT NULL,
	"cause_id" text,
	CONSTRAINT "learning_node_status_person_id_item_id_pk" PRIMARY KEY("person_id","item_id"),
	CONSTRAINT "learning_node_status_cause" CHECK ("learning_node_status"."cause_kind" IN ('fact', 'rule-change'))
);
--> statement-breakpoint
CREATE TABLE "learning_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"values" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_presets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "learning_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"corrective_step_id" uuid,
	"corrective_text" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_rule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"earned_progress" text NOT NULL,
	"actor_sub" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_rule_changes_earned" CHECK ("learning_rule_changes"."earned_progress" IN ('keep', 'require-again'))
);
--> statement-breakpoint
CREATE TABLE "learning_rule_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_preset_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_rule_layers_scope_key" UNIQUE("scope_kind","scope_id"),
	CONSTRAINT "learning_rule_layers_scope_kind" CHECK ("learning_rule_layers"."scope_kind" IN ('platform', 'school', 'course', 'module', 'lesson', 'step'))
);
--> statement-breakpoint
CREATE TABLE "learning_schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction_id" uuid NOT NULL,
	"lead_expert_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"state" "learning_state" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_schools_slug_unique" UNIQUE("slug"),
	CONSTRAINT "learning_schools_direction_expert_key" UNIQUE("direction_id","lead_expert_id")
);
--> statement-breakpoint
CREATE TABLE "learning_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"duration_min" integer NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"partner_organisation_id" uuid,
	"companion" boolean DEFAULT false NOT NULL,
	"provider" "stream_provider",
	"embed_ref" text,
	"media_ref" text,
	"media_content_type" text,
	"media_size_bytes" integer,
	"removed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_steps_duration_positive" CHECK ("learning_steps"."duration_min" > 0),
	CONSTRAINT "learning_steps_source_pair" CHECK (("learning_steps"."provider" IS NULL) = ("learning_steps"."embed_ref" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "learning_tests" (
	"step_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"scope_item" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_tests_kind" CHECK ("learning_tests"."kind" IN ('entry', 'exit', 'test-out'))
);
--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_test_id_learning_tests_step_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."learning_tests"("step_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_school_id_learning_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."learning_schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_facts" ADD CONSTRAINT "learning_facts_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_facts" ADD CONSTRAINT "learning_facts_step_id_learning_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."learning_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_feedback" ADD CONSTRAINT "learning_feedback_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_feedback" ADD CONSTRAINT "learning_feedback_step_id_learning_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."learning_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_lesson_ratings" ADD CONSTRAINT "learning_lesson_ratings_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_lesson_ratings" ADD CONSTRAINT "learning_lesson_ratings_lesson_id_learning_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."learning_lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_lessons" ADD CONSTRAINT "learning_lessons_module_id_learning_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."learning_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_lessons" ADD CONSTRAINT "learning_lessons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_modules" ADD CONSTRAINT "learning_modules_course_id_learning_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."learning_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_node_status" ADD CONSTRAINT "learning_node_status_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_options" ADD CONSTRAINT "learning_options_question_id_learning_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."learning_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_questions" ADD CONSTRAINT "learning_questions_test_id_learning_tests_step_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."learning_tests"("step_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_questions" ADD CONSTRAINT "learning_questions_corrective_step_id_learning_steps_id_fk" FOREIGN KEY ("corrective_step_id") REFERENCES "public"."learning_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_rule_layers" ADD CONSTRAINT "learning_rule_layers_applied_preset_id_learning_presets_id_fk" FOREIGN KEY ("applied_preset_id") REFERENCES "public"."learning_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD CONSTRAINT "learning_schools_direction_id_directions_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."directions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD CONSTRAINT "learning_schools_lead_expert_id_experts_id_fk" FOREIGN KEY ("lead_expert_id") REFERENCES "public"."experts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_schools" ADD CONSTRAINT "learning_schools_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_steps" ADD CONSTRAINT "learning_steps_lesson_id_learning_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."learning_lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_steps" ADD CONSTRAINT "learning_steps_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tests" ADD CONSTRAINT "learning_tests_step_id_learning_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."learning_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_attempts_person_test_idx" ON "learning_attempts" USING btree ("person_id","test_id","started_at");--> statement-breakpoint
CREATE INDEX "learning_facts_person_idx" ON "learning_facts" USING btree ("person_id","recorded_at");--> statement-breakpoint
CREATE INDEX "learning_lessons_module_idx" ON "learning_lessons" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "learning_modules_course_idx" ON "learning_modules" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "learning_options_question_idx" ON "learning_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE INDEX "learning_questions_test_idx" ON "learning_questions" USING btree ("test_id","position");--> statement-breakpoint
CREATE INDEX "learning_steps_lesson_idx" ON "learning_steps" USING btree ("lesson_id","position");--> statement-breakpoint
-- ── hand-written: 024 facts are append-only (ADR-0003 §2.7, 024 EARS-10) ──────
-- The one carve-out: the ADR-0009 erasure procedure re-points `person_id` (and
-- only it) with `SET LOCAL app.learning_erasure = 'on'`.
CREATE OR REPLACE FUNCTION learning_facts_append_only() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND current_setting('app.learning_erasure', true) = 'on'
		AND (to_jsonb(NEW) - 'person_id') = (to_jsonb(OLD) - 'person_id') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'learning_facts is append-only (024 EARS-10): % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER learning_facts_no_mutate
	BEFORE UPDATE OR DELETE ON "learning_facts"
	FOR EACH ROW EXECUTE FUNCTION learning_facts_append_only();
--> statement-breakpoint
-- ── feature-010 PD masking (010 EARS-7) ────────────────────────────────────
-- `learning_feedback.text` is the doctor's free-text comment on a step: it can
-- carry anything typed (names, contacts), so the audit diff masks it. This
-- regenerates the whole registry (mirror: AUDIT_PD_COLUMNS in
-- packages/db/src/audit.ts, parity asserted by universal-edit-audit.e2e-spec).
CREATE OR REPLACE FUNCTION audit_pd_columns(p_table text) RETURNS text[] AS $$
  SELECT CASE p_table
    WHEN 'users' THEN ARRAY['email', 'phone', 'display_name']
    WHEN 'consent_records' THEN ARRAY['user_id']
    WHEN 'registrations' THEN ARRAY['answers']
    WHEN 'congress_submissions' THEN ARRAY['authors']
    WHEN 'learning_feedback' THEN ARRAY['text']
    ELSE ARRAY[]::text[]
  END;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
-- ── feature-010 audit attachment (010 EARS-8) ──────────────────────────────
-- Every mutable 024 table carries the row audit; `learning_facts` (append-only,
-- itself the record) and `learning_node_status` (a rebuildable projection) are
-- allowlisted in packages/db/src/audit.ts.
CREATE TRIGGER learning_schools_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_schools" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_courses_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_courses" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_modules_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_modules" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_lessons_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_lessons" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_steps_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_steps" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_tests_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_tests" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_questions_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_questions" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_options_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_options" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_presets_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_presets" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_rule_layers_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_rule_layers" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_rule_changes_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_rule_changes" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_attempts_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_attempts" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_lesson_ratings_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_lesson_ratings" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER learning_feedback_audit AFTER INSERT OR UPDATE OR DELETE
  ON "learning_feedback" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- learning-seed:begin — EARS-5 / EARS-9: the platform layer (every key) and the
-- three presets, exactly LEARNING_PLATFORM_SEED / LEARNING_PRESET_SEEDS of
-- packages/learning/src/rules/seed.ts (an api e2e pins rows = constants).
INSERT INTO "learning_rule_layers" ("scope_kind", "scope_id", "values") VALUES
	('platform', 'platform', '{"completion.step":{"condition":"viewed"},"completion.lesson":{"all":[{"condition":"all-steps-done"},{"condition":"test-passed","test":"exit"}]},"completion.module":{"all":[{"condition":"lessons-done"},{"condition":"club-attended"}]},"completion.course":{"condition":"lessons-done"},"viewed.video.percent":100,"viewed.podcast.percent":90,"unlock":{"kind":"after-previous"},"order":"strict","lockedVisibility":"locked","test.threshold":80,"test.attempts":"unlimited","test.pauseMin":0,"test.questions":"all","test.exitRequired":true,"test.entryRequired":false,"test.entryCounts":false,"testOut.allowed":false,"testOut.pauseMin":0,"repeat.allowed":true,"progress.maxPlaybackRate":2,"progress.slackSec":30,"course.deliveryMode":"online","course.moduleSize":6,"course.closingClub":true,"course.clubInCompletion":false}'::jsonb);
--> statement-breakpoint
INSERT INTO "learning_presets" ("name", "values") VALUES
	('Путь (Duolingo)', '{"order":"strict","unlock":{"kind":"after-previous"},"testOut.allowed":true,"repeat.allowed":true,"lockedVisibility":"locked","test.exitRequired":true}'::jsonb),
	('Открытый курс', '{"unlock":{"kind":"immediate"},"order":"free","completion.lesson":{"all":[{"condition":"all-steps-done"},{"condition":"test-passed","test":"exit"}]},"test.exitRequired":true}'::jsonb),
	('ДПО / аккредитация', '{"completion.lesson":{"all":[{"condition":"all-steps-done"},{"condition":"test-passed","test":"exit"}]},"test.threshold":80,"test.entryRequired":true,"order":"strict","testOut.allowed":false,"test.exitRequired":true}'::jsonb);
-- learning-seed:end
--> statement-breakpoint
-- 012 media pipeline: a step's video / download file is a media slot whose
-- released object the cleanup worker reclaims (024-design §2).
ALTER TYPE "public"."media_entity_kind" ADD VALUE 'learning_step';--> statement-breakpoint
ALTER TYPE "public"."media_slot" ADD VALUE 'file';
