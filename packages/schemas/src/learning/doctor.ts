import { z } from "zod";
import { StreamProviderSchema } from "../events/events.schema.js";
import { LearningElementTypeSchema } from "./settings.js";

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

// ── The course path (EARS-13) ───────────────────────────────────────────────

export const LearningPathStepSchema = z.strictObject({
  id: z.uuid(),
  type: LearningElementTypeSchema,
  title: z.string(),
  durationMin: z.number().int(),
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
export const LearningCoursePathSchema = z.strictObject({
  course: z.strictObject({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    state: LearningNodeStateSchema,
  }),
  /** false = a guest; states computed with no facts (EARS-13). */
  signedIn: z.boolean(),
  modules: z.array(LearningPathModuleSchema),
  /** The course document node, last on the path. */
  document: z.strictObject({ state: LearningNodeStateSchema }),
  /** «Вы здесь» — the first open, not done step; null when none. */
  current: z.strictObject({ stepId: z.uuid(), lessonId: z.uuid() }).nullable(),
});
export type LearningCoursePath = z.infer<typeof LearningCoursePathSchema>;

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
    completionSentence: z.string(),
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
