import { z } from "zod";
import { StreamProviderSchema } from "../events/events.schema.js";
import {
  LEARNING_SETTING_KEYS,
  LearningElementTypeSchema,
  LearningScopeKindSchema,
  type LearningSettingKey,
} from "./settings.js";
import {
  LearningDocumentKindSchema,
  LearningSchoolFactSchema,
} from "./structure.js";

// 024 EARS-10, EARS-11, EARS-13, EARS-15, EARS-17, EARS-18 — the doctor-side
// reads and writes, served alike to the website and the mobile app (EARS-25).

/** EARS-11 — why a node is locked. */
export const LearningLockReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("previous") }),
  z.strictObject({ kind: z.literal("date"), at: z.iso.datetime() }),
  z.strictObject({ kind: z.literal("expression") }),
  z.strictObject({ kind: z.literal("registration") }),
]);
export type LearningLockReason = z.infer<typeof LearningLockReasonSchema>;

/** EARS-11 — a computed node state. */
export const LearningNodeStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("done") }),
  z.strictObject({ status: z.literal("current") }),
  z.strictObject({ status: z.literal("open") }),
  z.strictObject({
    status: z.literal("locked"),
    reason: LearningLockReasonSchema,
  }),
  z.strictObject({ status: z.literal("test-out-reachable") }),
]);
export type LearningNodeState = z.infer<typeof LearningNodeStateSchema>;
export type LearningNodeStatus = LearningNodeState["status"];

/**
 * EARS-24 — why a lesson's status changed under the doctor: the rule change
 * (EARS-31) that changed it, structured for the UI's sentence builder — what
 * changed (each setting of the changed scope, before → after; `null` = not set
 * there, inherited) and what is needed now (the new status and the lesson's
 * completion sentence under the new rules). Present only WHILE the lesson's
 * status was last changed by a rule change: the doctor's next completion
 * clears it, and no fact of the doctor changes.
 */
export const LearningStatusReasonSchema = z.strictObject({
  ruleChangeId: z.uuid(),
  at: z.iso.datetime(),
  scope: z.strictObject({
    kind: LearningScopeKindSchema,
    id: z.string(),
  }),
  changed: z.array(
    z.strictObject({
      key: z.enum(
        LEARNING_SETTING_KEYS as [LearningSettingKey, ...LearningSettingKey[]],
      ),
      before: z.unknown(),
      after: z.unknown(),
    }),
  ),
  needed: z.strictObject({
    status: z.enum(["done", "current", "open", "locked", "test-out-reachable"]),
    completionSentence: z.string(),
  }),
});
export type LearningStatusReason = z.infer<typeof LearningStatusReasonSchema>;

// ── The course path (EARS-13) ───────────────────────────────────────────────

/**
 * EARS-13 — a test step's kicker facts: the questions one attempt draws
 * (`test.questions`, or every live question) and the resolved pass mark
 * (`test.threshold`, whole percent, EARS-8). No question text (EARS-22).
 */
export const LearningPathTestFactsSchema = z.strictObject({
  questionCount: z.number().int().min(0),
  threshold: z.number().int().min(0).max(100),
});

/**
 * EARS-13 — a download step's kicker facts: the uploaded file's format label
 * («PDF», from its content type or extension) and size. No file URL (EARS-22).
 */
export const LearningPathFileFactsSchema = z.strictObject({
  format: z.string().min(1),
  sizeBytes: z.number().int().min(0),
});

export const LearningPathStepSchema = z.strictObject({
  id: z.uuid(),
  type: LearningElementTypeSchema,
  title: z.string(),
  durationMin: z.number().int(),
  /** A test step's facts; null for any other type. */
  test: LearningPathTestFactsSchema.nullable(),
  /** A download step's file facts; null for any other type (or with no file uploaded). */
  file: LearningPathFileFactsSchema.nullable(),
  state: LearningNodeStateSchema,
});
export type LearningPathStep = z.infer<typeof LearningPathStepSchema>;

export const LearningPathLessonSchema = z.strictObject({
  id: z.uuid(),
  /** «Урок N» — the lesson's ordinal in the whole course, from 1. */
  number: z.number().int().min(1),
  title: z.string(),
  durationMin: z.number().int(),
  stepCount: z.number().int(),
  state: LearningNodeStateSchema,
  /** EARS-24 — present WHILE the status was last changed by a rule change. */
  statusReason: LearningStatusReasonSchema.optional(),
  steps: z.array(LearningPathStepSchema),
});
export type LearningPathLesson = z.infer<typeof LearningPathLessonSchema>;

export const LearningPathModuleSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  position: z.number().int(),
  state: LearningNodeStateSchema,
  lessons: z.array(LearningPathLessonSchema),
  /** The module's club node WHILE `course.closingClub` is on, else null. */
  club: z.strictObject({ state: LearningNodeStateSchema }).nullable(),
});
export type LearningPathModule = z.infer<typeof LearningPathModuleSchema>;

/** `GET /v1/learning/courses/{courseSlug}/path`. */
/** A named place the course sits under — its direction and its school (EARS-14). */
export const LearningPathPlaceSchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
});

/** The course author — the school's leading expert (EARS-14); null unless the expert is public and named. */
export const LearningPathAuthorSchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  credentials: z.string().nullable(),
  affiliation: z.string().nullable(),
  /** Issued at read time from the stored photo; null without one. */
  photoUrl: z.string().nullable(),
});
export type LearningPathAuthor = z.infer<typeof LearningPathAuthorSchema>;

/** 023 EARS-22 — a course's partner: the 032 organisation's name, only WHILE it is shown publicly. */
export const LearningCoursePartnerSchema = z.strictObject({ name: z.string() });

/** 023 EARS-1 — the document a course leads to and what it needs. */
export const LearningCourseDocumentSchema = z.strictObject({
  kind: LearningDocumentKindSchema,
  prerequisites: z.string(),
});

export const LearningCoursePathSchema = z.strictObject({
  course: z.strictObject({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    state: LearningNodeStateSchema,
    /** 023 EARS-11 — the course header's data (023 EARS-1). */
    description: z.string(),
    academicHours: z.number().int(),
    /** Published lessons of the course. */
    lessonCount: z.number().int(),
    document: LearningCourseDocumentSchema,
    partner: LearningCoursePartnerSchema.nullable(),
    /**
     * 023 EARS-11, EARS-13 — the 024 sentence builder's summary for the course
     * scope from its resolved rules: what opens when, what counts as done and
     * that the certificate needs the whole course; never a preset's name.
     */
    rulesSummary: z.string(),
  }),
  /** The breadcrumb above the course: its direction (null unless public) and its school (EARS-14). */
  direction: LearningPathPlaceSchema.nullable(),
  school: LearningPathPlaceSchema,
  author: LearningPathAuthorSchema.nullable(),
  /** false = a guest; states computed with no facts (EARS-13). */
  signedIn: z.boolean(),
  modules: z.array(LearningPathModuleSchema),
  /** The course document node, last on the path. */
  document: z.strictObject({ state: LearningNodeStateSchema }),
  /** «Вы здесь» — the first open, not done step; null when none. */
  current: z.strictObject({ stepId: z.uuid(), lessonId: z.uuid() }).nullable(),
});
export type LearningCoursePath = z.infer<typeof LearningCoursePathSchema>;

// ── The school (023 EARS-3) ─────────────────────────────────────────────────

/** 023 EARS-3 — a doctor's state of one course (023-design §4); no percent. */
export const LearningCourseProgressSchema = z.enum([
  "not-started",
  "started",
  "done",
]);
export type LearningCourseProgress = z.infer<
  typeof LearningCourseProgressSchema
>;

/** 023 EARS-3 — one published course of the school, in school order. */
export const LearningSchoolCourseSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  lessonCount: z.number().int(),
  academicHours: z.number().int(),
  document: LearningCourseDocumentSchema,
  partner: LearningCoursePartnerSchema.nullable(),
  /** The signed-in doctor's state of the course; null for a guest. */
  state: LearningCourseProgressSchema.nullable(),
  /**
   * WHILE `state` is `started`, the course-wide ordinal (from 1) of the lesson
   * holding the doctor's current step — the card's «Продолжить — урок N →»;
   * null otherwise (023-design §4). No percent is sent.
   */
  nextLessonNumber: z.number().int().positive().nullable(),
});
export type LearningSchoolCourse = z.infer<typeof LearningSchoolCourseSchema>;

/** `GET /v1/learning/schools/{schoolSlug}` (023 EARS-3). */
export const LearningSchoolReadSchema = z.strictObject({
  school: z.strictObject({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    facts: z.array(LearningSchoolFactSchema),
    soonNote: z.string().nullable(),
    communityUrl: z.string().nullable(),
    mentoringOffer: z.string().nullable(),
    internshipOffer: z.string().nullable(),
    /** `soon` WHILE the school has no published course. */
    status: z.enum(["open", "soon"]),
    /** Published courses and the published lessons of those courses. */
    courseCount: z.number().int(),
    lessonCount: z.number().int(),
  }),
  /** The school's direction; null unless published. */
  direction: LearningPathPlaceSchema.nullable(),
  /** The school's leading expert; null unless public and named. */
  expert: LearningPathAuthorSchema.nullable(),
  /** false = a guest; every course `state` is then null. */
  signedIn: z.boolean(),
  courses: z.array(LearningSchoolCourseSchema),
});
export type LearningSchoolRead = z.infer<typeof LearningSchoolReadSchema>;

// ── The lesson (EARS-15, EARS-17) ───────────────────────────────────────────

export const LearningLessonStepSchema = LearningPathStepSchema.extend({
  /** EARS-17 — the step's completion sentence, built from its resolved rule. */
  completionSentence: z.string(),
});
export type LearningLessonStep = z.infer<typeof LearningLessonStepSchema>;

/** `GET /v1/learning/lessons/{lessonId}` — no step payload (EARS-15, EARS-22). */
export const LearningLessonReadSchema = z.strictObject({
  course: z.strictObject({ id: z.uuid(), slug: z.string(), title: z.string() }),
  lesson: z.strictObject({
    id: z.uuid(),
    number: z.number().int().min(1),
    title: z.string(),
    description: z.string(),
    teaser: z.string(),
    durationMin: z.number().int(),
    stepCount: z.number().int(),
    state: LearningNodeStateSchema,
    /** EARS-24 — present WHILE the status was last changed by a rule change. */
    statusReason: LearningStatusReasonSchema.optional(),
    completionSentence: z.string(),
    /** 023 EARS-21 — the lesson's first step on the path, so any lesson link opens the 024 step route; null without one. */
    firstStepId: z.uuid().nullable(),
  }),
  signedIn: z.boolean(),
  steps: z.array(LearningLessonStepSchema),
});
export type LearningLessonRead = z.infer<typeof LearningLessonReadSchema>;

// ── The step payload (EARS-15, EARS-16, EARS-18) ────────────────────────────

export const LearningStepBodySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("video"),
    /** The 006 provider abstraction: the player is built from `{ provider, embedRef }` (EARS-22: signed-in reads only). */
    provider: StreamProviderSchema,
    embedRef: z.string(),
    durationSec: z.number().int(),
    /** «Просмотрено 35 %» — the watched share, whole percent, capped at 100. */
    watchedPercent: z.number().int().min(0).max(100),
    positionSec: z.number().int().min(0),
  }),
  z.strictObject({
    type: z.literal("download"),
    /** A short-lived signed URL of the 012 media object (EARS-22: signed-in reads only). */
    mediaUrl: z.string(),
    fileName: z.string(),
    fileSizeBytes: z.number().int(),
    opened: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("test"),
    testId: z.uuid(),
    kind: z.literal("exit"),
    questionCount: z.number().int(),
    threshold: z.number().int(),
    /** null = unlimited. */
    attemptsLeft: z.number().int().nullable(),
    lastResult: z
      .strictObject({ score: z.number().int(), passed: z.boolean() })
      .nullable(),
  }),
]);
export type LearningStepBody = z.infer<typeof LearningStepBodySchema>;

/** `GET /v1/me/learning/steps/{stepId}` — an openable step only. */
export const LearningStepReadSchema = z.strictObject({
  courseSlug: z.string(),
  lessonId: z.uuid(),
  step: LearningLessonStepSchema,
  lessonCompletionSentence: z.string(),
  body: LearningStepBodySchema,
  /** The next step WHEN the order allows it (it is not locked), else null. */
  nextStepId: z.uuid().nullable(),
});
export type LearningStepRead = z.infer<typeof LearningStepReadSchema>;

// ── Facts intake (EARS-10) ──────────────────────────────────────────────────

const factBase = {
  /** The client's event id; a replay answers as a duplicate. */
  eventId: z
    .string()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9:._-]+$/),
  stepId: z.uuid(),
  source: z.enum(["web", "app"]),
  /** The client's clock, kept for information only; the server sets the fact's time (EARS-10). */
  clientOccurredAt: z.iso.datetime().optional(),
};

/** `POST /v1/me/learning/facts` — the client-reportable progress kinds of this slice. */
export const RecordLearningFactRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...factBase,
    kind: z.literal("position"),
    data: z.strictObject({ positionSec: z.number().int().min(0).max(86_400) }),
  }),
  z.strictObject({
    ...factBase,
    kind: z.literal("opened"),
    data: z.strictObject({}).default({}),
  }),
]);
export type RecordLearningFactRequest = z.input<
  typeof RecordLearningFactRequestSchema
>;

export const LearningStatusChangeSchema = z.strictObject({
  itemKind: z.enum(["step", "lesson", "module", "course"]),
  itemId: z.uuid(),
  status: z.enum(["done", "current", "open", "locked", "test-out-reachable"]),
});

export const RecordLearningFactResponseSchema = z.strictObject({
  outcome: z.enum(["recorded", "duplicate"]),
  changed: z.array(LearningStatusChangeSchema),
  /**
   * A video step's progress as the server holds it after this fact — the
   * clamped position and the watched share the condition reads (EARS-10);
   * null for a step that records no position.
   */
  progress: z
    .strictObject({
      positionSec: z.number().int().min(0),
      watchedPercent: z.number().int().min(0).max(100),
    })
    .nullable(),
});
export type RecordLearningFactResponse = z.infer<
  typeof RecordLearningFactResponseSchema
>;

// ── Attempts (EARS-18) ──────────────────────────────────────────────────────

/** An attempt's questions — never the correct answers. */
export const LearningAttemptSchema = z.strictObject({
  attemptId: z.uuid(),
  testId: z.uuid(),
  questions: z.array(
    z.strictObject({
      id: z.uuid(),
      text: z.string(),
      options: z.array(z.strictObject({ id: z.uuid(), text: z.string() })),
    }),
  ),
});
export type LearningAttempt = z.infer<typeof LearningAttemptSchema>;

export const SubmitLearningAttemptRequestSchema = z.strictObject({
  answers: z
    .array(z.strictObject({ questionId: z.uuid(), optionId: z.uuid() }))
    .max(200),
});
export type SubmitLearningAttemptRequest = z.infer<
  typeof SubmitLearningAttemptRequestSchema
>;

export const LearningAttemptResultSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  threshold: z.number().int(),
  passed: z.boolean(),
  /** null = unlimited. */
  attemptsLeft: z.number().int().nullable(),
  /** When the next attempt opens, if a pause applies; else null. */
  nextAt: z.iso.datetime().nullable(),
  changed: z.array(LearningStatusChangeSchema),
});
export type LearningAttemptResult = z.infer<typeof LearningAttemptResultSchema>;
