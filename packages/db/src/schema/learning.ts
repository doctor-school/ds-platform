import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { directions, experts, organisations, projects } from "./taxonomy.js";
import { users } from "./users.js";

// 024 — the learning path (024-design §2; ADR-0016 §4, §5, §8, §9; ADR-0003 §2.7).
//
// Storefront ownership (ADR-0016 §8): the structure rows (schools, courses,
// modules, lessons, steps, tests), the facts, the projection, ratings and
// feedback are `doctor`; the rule layers, presets and rule changes are
// `admin-only`.
//
// drizzle does not model the append-only trigger on `learning_facts` or the 010
// `audit_row_change()` attachments — that DDL is hand-written in migration
// `0062_learning_path.sql`; the seed rows of the platform layer and the three
// presets are inserted there too (EARS-5, EARS-9).

/** The structure's two-state lifecycle (EARS-1, EARS-4). */
export const learningState = pgEnum("learning_state", ["draft", "published"]);

const versioned = {
  /** Optimistic-concurrency counter behind the admin ETag; starts at 1. */
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/** EARS-1 — the minimal school row; one school per leading expert and direction. Ownership `doctor`. */
export const learningSchools = pgTable(
  "learning_schools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    directionId: uuid("direction_id")
      .notNull()
      .references(() => directions.id),
    leadExpertId: uuid("lead_expert_id")
      .notNull()
      .references(() => experts.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    state: learningState("state").notNull().default("draft"),
    ...versioned,
  },
  (t) => [
    unique("learning_schools_direction_expert_key").on(
      t.directionId,
      t.leadExpertId,
    ),
  ],
);

/** EARS-1 — a course always lives in a school (`school_id` NOT NULL). Ownership `doctor`. */
export const learningCourses = pgTable("learning_courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => learningSchools.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  state: learningState("state").notNull().default("draft"),
  ...versioned,
});

/** EARS-1 — a course's ordered modules. Ownership `doctor`. */
export const learningModules = pgTable(
  "learning_modules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => learningCourses.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    ...versioned,
  },
  (t) => [index("learning_modules_course_idx").on(t.courseId, t.position)],
);

/** EARS-1 — a module's ordered lessons; the lesson is the funding unit (ADR-0016 §4). Ownership `doctor`. */
export const learningLessons = pgTable(
  "learning_lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => learningModules.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    teaser: text("teaser").notNull().default(""),
    state: learningState("state").notNull().default("draft"),
    ...versioned,
  },
  (t) => [index("learning_lessons_module_idx").on(t.moduleId, t.position)],
);

/**
 * EARS-1, EARS-2 — a lesson's ordered steps. `type` is an element-type name of
 * the `@ds/learning` catalog (code, so not a DB enum); `payload` is validated by
 * that type's schema on write. A removed step keeps its row (its facts point
 * at it) and leaves the composition. Ownership `doctor`.
 */
export const learningSteps = pgTable(
  "learning_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => learningLessons.id),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    durationMin: integer("duration_min").notNull(),
    payload: jsonb("payload").notNull().default({}),
    partnerOrganisationId: uuid("partner_organisation_id").references(
      () => organisations.id,
    ),
    companion: boolean("companion").notNull().default(false),
    /**
     * The step's media under the 012 media contract: the server-generated
     * object key of the uploaded `video` / `download` file (a registered media
     * slot), its content type and size. Never client input, never served raw —
     * the doctor's gated step read signs it (EARS-22).
     */
    mediaRef: text("media_ref"),
    mediaContentType: text("media_content_type"),
    mediaSizeBytes: integer("media_size_bytes"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...versioned,
  },
  (t) => [
    index("learning_steps_lesson_idx").on(t.lessonId, t.position),
    check("learning_steps_duration_positive", sql`${t.durationMin} > 0`),
  ],
);

/** A test attached to its `test` step (024-design §2 «Tests»). Ownership `doctor`. */
export const learningTests = pgTable(
  "learning_tests",
  {
    stepId: uuid("step_id")
      .primaryKey()
      .references(() => learningSteps.id),
    kind: text("kind").notNull(),
    /** The lesson or module a test-out test reaches (#4014); null otherwise. */
    scopeItem: uuid("scope_item"),
    ...versioned,
  },
  (t) => [
    check(
      "learning_tests_kind",
      sql`${t.kind} IN ('entry', 'exit', 'test-out')`,
    ),
  ],
);

/** A test's questions; corrective material per question (EARS-19, #4014). Ownership `doctor`. */
export const learningQuestions = pgTable(
  "learning_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    testId: uuid("test_id")
      .notNull()
      .references(() => learningTests.stepId),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    correctiveStepId: uuid("corrective_step_id").references(
      () => learningSteps.id,
    ),
    correctiveText: text("corrective_text"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("learning_questions_test_idx").on(t.testId, t.position)],
);

/** A question's options; `correct` never reaches a doctor (EARS-18). Ownership `doctor`. */
export const learningOptions = pgTable(
  "learning_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => learningQuestions.id),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    correct: boolean("correct").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("learning_options_question_idx").on(t.questionId, t.position)],
);

/** EARS-9 — a preset as data, seeded with three rows by 0062. Ownership `admin-only`. */
export const learningPresets = pgTable("learning_presets", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  values: jsonb("values").notNull(),
  ...versioned,
});

/**
 * EARS-5 — one rule layer per scope; `values` a partial map of setting keys,
 * the platform row (`scope_id = 'platform'`) holding every key. Ownership
 * `admin-only`.
 */
export const learningRuleLayers = pgTable(
  "learning_rule_layers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    values: jsonb("values").notNull().default({}),
    appliedPresetId: uuid("applied_preset_id").references(
      () => learningPresets.id,
    ),
    ...versioned,
  },
  (t) => [
    unique("learning_rule_layers_scope_key").on(t.scopeKind, t.scopeId),
    check(
      "learning_rule_layers_scope_kind",
      sql`${t.scopeKind} IN ('platform', 'school', 'course', 'module', 'lesson', 'step')`,
    ),
  ],
);

/** EARS-31 (#4012) — one rule change on a published course. Ownership `admin-only`. */
export const learningRuleChanges = pgTable(
  "learning_rule_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    earnedProgress: text("earned_progress").notNull(),
    actorSub: text("actor_sub"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "learning_rule_changes_earned",
      sql`${t.earnedProgress} IN ('keep', 'require-again')`,
    ),
  ],
);

/**
 * EARS-10 — the append-only progress facts (ADR-0003 §2.7): a unique client or
 * server event id; a BEFORE UPDATE OR DELETE trigger raises (0062), except the
 * ADR-0009 erasure re-pointing of `person_id`. Ownership `doctor`.
 */
export const learningFacts = pgTable(
  "learning_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    stepId: uuid("step_id").references(() => learningSteps.id),
    itemRef: uuid("item_ref"),
    data: jsonb("data").notNull().default({}),
    source: text("source").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("learning_facts_person_idx").on(t.personId, t.recordedAt),
    // EARS-10 — a client event id is deduplicated per person: one doctor's id
    // can never collide with (and silently drop) another doctor's fact.
    unique("learning_facts_person_event_key").on(t.personId, t.eventId),
    check(
      "learning_facts_source",
      sql`${t.source} IN ('web', 'app', 'system')`,
    ),
  ],
);

/** EARS-18 — an attempt in progress until it is submitted. Ownership `doctor`. */
export const learningAttempts = pgTable(
  "learning_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => users.id),
    testId: uuid("test_id")
      .notNull()
      .references(() => learningTests.stepId),
    questionIds: jsonb("question_ids").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [
    index("learning_attempts_person_test_idx").on(
      t.personId,
      t.testId,
      t.startedAt,
    ),
  ],
);

/** EARS-11 — the rebuildable status projection, used to detect transitions (EARS-12). Ownership `doctor`. */
export const learningNodeStatus = pgTable(
  "learning_node_status",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => users.id),
    itemKind: text("item_kind").notNull(),
    itemId: uuid("item_id").notNull(),
    status: text("status").notNull(),
    since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
    causeKind: text("cause_kind").notNull(),
    causeId: text("cause_id"),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.itemId] }),
    check(
      "learning_node_status_cause",
      sql`${t.causeKind} IN ('fact', 'rule-change')`,
    ),
  ],
);

/** EARS-23 (#4013) — one rating per doctor and lesson. Ownership `doctor`. */
export const learningLessonRatings = pgTable(
  "learning_lesson_ratings",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => users.id),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => learningLessons.id),
    stars: integer("stars").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.lessonId] }),
    check("learning_lesson_ratings_stars", sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);

/** EARS-23 (#4013) — a doctor's feedback on a partner's step. Ownership `doctor`. */
export const learningFeedback = pgTable("learning_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  personId: uuid("person_id")
    .notNull()
    .references(() => users.id),
  stepId: uuid("step_id")
    .notNull()
    .references(() => learningSteps.id),
  text: text("text").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type LearningSchoolRow = typeof learningSchools.$inferSelect;
export type LearningCourseRow = typeof learningCourses.$inferSelect;
export type LearningModuleRow = typeof learningModules.$inferSelect;
export type LearningLessonRow = typeof learningLessons.$inferSelect;
export type LearningStepRow = typeof learningSteps.$inferSelect;
export type LearningFactRow = typeof learningFacts.$inferSelect;
