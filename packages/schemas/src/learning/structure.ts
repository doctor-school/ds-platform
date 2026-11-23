import { z } from "zod";
import {
  EmbedRefSchema,
  refineEmbedRefForProvider,
  StreamProviderSchema,
} from "../events/events.schema.js";
import {
  LearningElementTypeSchema,
  LearningResolvedSettingSchema,
  LearningScopeKindSchema,
  LearningSettingValuesSchema,
} from "./settings.js";

// 024 EARS-1, EARS-2, EARS-4, EARS-28, EARS-29 — the structure model's admin
// contracts (024-design §2, §7). Every write is JSON, idempotent and — except a
// create — under `If-Match` (the 012 conventions, EARS-30).

const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "lowercase letters, digits and single hyphens",
  );
const title = z.string().trim().min(1).max(200);
const text = z.string().trim().max(4000);

/** The learning structure's two-state lifecycle. */
export const LearningStateSchema = z.enum(["draft", "published"]);
export type LearningState = z.infer<typeof LearningStateSchema>;

// ── Step payloads per element type (EARS-2) ─────────────────────────────────

// A step's source is NOT in the payload. A `video` step plays from the 006
// provider abstraction, exactly as a 014 recording: `{ provider, embedRef }`
// set through `PUT /v1/admin/learning/steps/{stepId}/source`, stored in
// `learning_steps.provider` + `embed_ref`; the API never fetches or stores the
// media bytes. A `download` file rides the 012 media contract — uploaded
// through `PUT /v1/admin/learning/steps/{stepId}/media`, kept as a
// server-generated object key in `learning_steps.media_ref` (a registered
// media slot) and served only as a short-lived signed URL on the doctor's
// gated step read (EARS-22). No client ever sends or receives a storage key.

/** `PUT /v1/admin/learning/steps/{stepId}/source` — a video step's provider-scoped source. */
export const SetLearningStepSourceRequestSchema = z
  .strictObject({
    provider: StreamProviderSchema,
    embedRef: EmbedRefSchema,
  })
  .superRefine((value, ctx) => {
    refineEmbedRefForProvider(ctx, value.provider, value.embedRef);
  });
export type SetLearningStepSourceRequest = z.infer<
  typeof SetLearningStepSourceRequestSchema
>;

/** The provider-scoped source of a `video` step (admin and doctor reads alike). */
export const LearningStepSourceSchema = z.strictObject({
  provider: StreamProviderSchema,
  embedRef: z.string(),
});
export type LearningStepSource = z.infer<typeof LearningStepSourceSchema>;

/** The one multipart file part the step-media upload accepts. */
export const LEARNING_STEP_MEDIA_PART = "file";

/** The step-media size cap — the API's shared multipart cap (012 upload pipeline). */
export const LEARNING_STEP_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

/** `video` — a series episode; `durationSec` is the media's real length (EARS-10 cap). */
export const LearningVideoPayloadSchema = z.strictObject({
  durationSec: z.number().int().min(1).max(86_400),
});

/** `download` — a downloadable material; `fileName` is what the doctor saves. */
export const LearningDownloadPayloadSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
});

/** The admin view of a step's uploaded media — never its object key. */
export const LearningStepMediaAdminSchema = z.strictObject({
  contentType: z.string(),
  sizeBytes: z.number().int(),
});
export type LearningStepMediaAdmin = z.infer<
  typeof LearningStepMediaAdminSchema
>;

/** One option of a test question; `correct` never reaches a doctor (EARS-18). */
export const LearningTestOptionInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(1000),
  correct: z.boolean(),
});

/** One test question with exactly one correct option. */
export const LearningTestQuestionInputSchema = z
  .strictObject({
    text: z.string().trim().min(1).max(2000),
    options: z.array(LearningTestOptionInputSchema).min(2).max(10),
    correctiveText: z.string().trim().min(1).max(4000).optional(),
  })
  .refine((q) => q.options.filter((o) => o.correct).length === 1, {
    message: "exactly one option is correct",
    path: ["options"],
  });

/** `test` — the exit test of this slice (`entry` / `test-out` land with #4014). */
export const LearningTestPayloadSchema = z.strictObject({
  kind: z.literal("exit"),
  questions: z.array(LearningTestQuestionInputSchema).min(1).max(200),
});

export const LEARNING_STEP_PAYLOAD_SCHEMAS = {
  video: LearningVideoPayloadSchema,
  download: LearningDownloadPayloadSchema,
  test: LearningTestPayloadSchema,
} as const;

/** A step type's uploaded file under the 012 media contract. */
export interface LearningStepMediaRule {
  /** The content types the upload accepts. */
  readonly contentTypes: readonly string[];
  readonly maxBytes: number;
}

/**
 * EARS-2 / EARS-4 / EARS-28 — what each element type takes besides its
 * payload: an uploaded file (`media`) and/or a 006 provider source
 * (`providerSource`). The `@ds/learning` catalog, the API's upload check, the
 * publish requirements and the admin composition screen all read this one
 * table, so the screen offers exactly the inputs the server requires.
 */
export const LEARNING_STEP_INPUTS: Readonly<
  Record<
    z.infer<typeof LearningElementTypeSchema>,
    {
      readonly media: LearningStepMediaRule | null;
      readonly providerSource: boolean;
    }
  >
> = {
  video: { media: null, providerSource: true },
  download: {
    media: {
      contentTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maxBytes: LEARNING_STEP_MEDIA_MAX_BYTES,
    },
    providerSource: false,
  },
  test: { media: null, providerSource: false },
};

// ── Requests ────────────────────────────────────────────────────────────────

// 023 EARS-1 — the school's and the course's descriptive data over the 024 rows.

/** The most «О школе» facts a school carries (023 EARS-1). */
export const LEARNING_SCHOOL_FACTS_MAX = 4;

/** One «О школе» fact: a label and a text. */
export const LearningSchoolFactSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(300),
});
export type LearningSchoolFact = z.infer<typeof LearningSchoolFactSchema>;

export const LearningSchoolFactsSchema = z
  .array(LearningSchoolFactSchema)
  .max(LEARNING_SCHOOL_FACTS_MAX);

/** The document a course leads to (023 EARS-1). */
export const LearningDocumentKindSchema = z.enum([
  "certificate",
  "certificate-nmo",
]);
export type LearningDocumentKind = z.infer<typeof LearningDocumentKindSchema>;

const optionalText = text.min(1).nullable().default(null);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);

export const CreateLearningSchoolRequestSchema = z.strictObject({
  directionId: z.uuid(),
  leadExpertId: z.uuid(),
  projectId: z.uuid(),
  slug,
  title,
  description: text.default(""),
  facts: LearningSchoolFactsSchema.default([]),
  soonNote: optionalText,
  communityUrl: httpsUrl.nullable().default(null),
  mentoringOffer: optionalText,
  internshipOffer: optionalText,
});
export type CreateLearningSchoolRequest = z.infer<
  typeof CreateLearningSchoolRequestSchema
>;

/** EARS-1 — a course always names its school; 023 EARS-1 adds its data, placed last in the school. */
export const CreateLearningCourseRequestSchema = z.strictObject({
  schoolId: z.uuid(),
  projectId: z.uuid(),
  slug,
  title,
  description: text.default(""),
  academicHours: z.number().int().min(0).max(10_000).default(0),
  documentKind: LearningDocumentKindSchema.default("certificate"),
  documentPrerequisites: text.default(""),
  partnerOrganisationId: z.uuid().nullable().default(null),
});
export type CreateLearningCourseRequest = z.infer<
  typeof CreateLearningCourseRequestSchema
>;

export const CreateLearningModuleRequestSchema = z.strictObject({
  courseId: z.uuid(),
  title,
});
export type CreateLearningModuleRequest = z.infer<
  typeof CreateLearningModuleRequestSchema
>;

export const CreateLearningLessonRequestSchema = z.strictObject({
  moduleId: z.uuid(),
  projectId: z.uuid(),
  title,
  description: text.default(""),
  teaser: text.default(""),
});
export type CreateLearningLessonRequest = z.input<
  typeof CreateLearningLessonRequestSchema
>;

export const UpdateLearningLessonRequestSchema = z
  .strictObject({
    title: title.optional(),
    description: text.optional(),
    teaser: text.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });
export type UpdateLearningLessonRequest = z.infer<
  typeof UpdateLearningLessonRequestSchema
>;

/**
 * EARS-2 / EARS-28 — add a step. `type` is a string so an unknown type is
 * refused by the catalog with a `type` field error (EARS-2), and `payload` is
 * parsed by that type's schema.
 */
export const CreateLearningStepRequestSchema = z.strictObject({
  lessonId: z.uuid(),
  type: z.string().min(1).max(64),
  title,
  durationMin: z.number().int().min(1).max(600),
  payload: z.unknown(),
});
export type CreateLearningStepRequest = z.infer<
  typeof CreateLearningStepRequestSchema
>;

export const UpdateLearningStepRequestSchema = z
  .strictObject({
    title: title.optional(),
    durationMin: z.number().int().min(1).max(600).optional(),
    payload: z.unknown().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });
export type UpdateLearningStepRequest = z.infer<
  typeof UpdateLearningStepRequestSchema
>;

/** EARS-28 — the lesson's steps in their new order (every live step exactly once). */
export const ReorderLearningStepsRequestSchema = z.strictObject({
  stepIds: z.array(z.uuid()).min(1).max(200),
});
export type ReorderLearningStepsRequest = z.infer<
  typeof ReorderLearningStepsRequestSchema
>;

/** EARS-9 / EARS-29 — apply a preset on a school or a course. */
export const ApplyLearningPresetRequestSchema = z.strictObject({
  presetId: z.uuid(),
});
export type ApplyLearningPresetRequest = z.infer<
  typeof ApplyLearningPresetRequestSchema
>;

/**
 * EARS-31, owner D16 — what a rule change on a published course does to a
 * doctor's earned completion: «keep» (the default) stores a `completion-kept`
 * fact for every item that was done and would no longer be; «require-again»
 * lets the new rules decide.
 */
export const LEARNING_EARNED_PROGRESS = ["keep", "require-again"] as const;
export const LearningEarnedProgressSchema = z.enum(LEARNING_EARNED_PROGRESS);
export type LearningEarnedProgress = z.infer<
  typeof LearningEarnedProgressSchema
>;

/**
 * EARS-29, EARS-31 — replace a scope's own values. `values` is validated per
 * scope by the rules validator (EARS-6); `earnedProgress` counts only on a
 * scope a published course resolves through.
 */
export const SetLearningScopeRulesRequestSchema = z.strictObject({
  values: z.record(z.string(), z.unknown()),
  earnedProgress: LearningEarnedProgressSchema.default("keep"),
});
export type SetLearningScopeRulesRequest = z.input<
  typeof SetLearningScopeRulesRequestSchema
>;

/** EARS-31 — the change dialog's question: the new values, nothing written. */
export const PreviewLearningRuleChangeRequestSchema = z.strictObject({
  values: z.record(z.string(), z.unknown()),
});
export type PreviewLearningRuleChangeRequest = z.infer<
  typeof PreviewLearningRuleChangeRequestSchema
>;

/**
 * EARS-31 — the doctors whose statuses would change under the new values
 * (the evaluator over their facts, old rules vs new); `toDone` / `toNotDone`
 * count the doctors with at least one item turning done / no longer done.
 */
export const LearningRuleChangePreviewSchema = z.strictObject({
  affectedDoctors: z.number().int().min(0),
  toDone: z.number().int().min(0),
  toNotDone: z.number().int().min(0),
});
export type LearningRuleChangePreview = z.infer<
  typeof LearningRuleChangePreviewSchema
>;

/** EARS-9, EARS-29 — replace a preset's values (`learning_rules_editor`). */
export const UpdateLearningPresetRequestSchema = z.strictObject({
  values: z.record(z.string(), z.unknown()),
});
export type UpdateLearningPresetRequest = z.infer<
  typeof UpdateLearningPresetRequestSchema
>;

// ── Admin read models ───────────────────────────────────────────────────────

export const LearningSchoolAdminSchema = z.strictObject({
  id: z.uuid(),
  directionId: z.uuid(),
  leadExpertId: z.uuid(),
  projectId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  state: LearningStateSchema,
  description: z.string(),
  facts: z.array(LearningSchoolFactSchema),
  soonNote: z.string().nullable(),
  communityUrl: z.string().nullable(),
  mentoringOffer: z.string().nullable(),
  internshipOffer: z.string().nullable(),
  version: z.number().int(),
});
export type LearningSchoolAdmin = z.infer<typeof LearningSchoolAdminSchema>;

export const LearningCourseAdminSchema = z.strictObject({
  id: z.uuid(),
  schoolId: z.uuid(),
  projectId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  state: LearningStateSchema,
  description: z.string(),
  academicHours: z.number().int(),
  documentKind: LearningDocumentKindSchema,
  documentPrerequisites: z.string(),
  partnerOrganisationId: z.uuid().nullable(),
  /** The course's place in its school, from 1. */
  position: z.number().int(),
  version: z.number().int(),
});
export type LearningCourseAdmin = z.infer<typeof LearningCourseAdminSchema>;

export const LearningModuleAdminSchema = z.strictObject({
  id: z.uuid(),
  courseId: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  version: z.number().int(),
});
export type LearningModuleAdmin = z.infer<typeof LearningModuleAdminSchema>;

export const LearningTestOptionAdminSchema = z.strictObject({
  id: z.uuid(),
  text: z.string(),
  correct: z.boolean(),
});
export const LearningTestQuestionAdminSchema = z.strictObject({
  id: z.uuid(),
  text: z.string(),
  correctiveText: z.string().nullable(),
  options: z.array(LearningTestOptionAdminSchema),
});

export const LearningStepAdminSchema = z.strictObject({
  id: z.uuid(),
  lessonId: z.uuid(),
  position: z.number().int(),
  type: LearningElementTypeSchema,
  title: z.string(),
  durationMin: z.number().int(),
  /** The stored payload; for `test` the `kind` only — questions are in `questions`. */
  payload: z.record(z.string(), z.unknown()),
  questions: z.array(LearningTestQuestionAdminSchema).nullable(),
  /** The uploaded file of a `download` step; null = none yet (or another type). */
  media: LearningStepMediaAdminSchema.nullable(),
  /** The provider source of a `video` step; null = none yet (or another type). */
  source: LearningStepSourceSchema.nullable(),
  version: z.number().int(),
});
export type LearningStepAdmin = z.infer<typeof LearningStepAdminSchema>;

export const LearningLessonAdminSchema = z.strictObject({
  id: z.uuid(),
  moduleId: z.uuid(),
  projectId: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  description: z.string(),
  teaser: z.string(),
  state: LearningStateSchema,
  /** EARS-1 — the sum of the steps' durations. */
  durationMin: z.number().int(),
  steps: z.array(LearningStepAdminSchema),
  version: z.number().int(),
});
export type LearningLessonAdmin = z.infer<typeof LearningLessonAdminSchema>;

/** The course composition: modules → lessons (no steps) for the admin outline. */
export const LearningCourseCompositionSchema = LearningCourseAdminSchema.extend(
  {
    modules: z.array(
      LearningModuleAdminSchema.extend({
        lessons: z.array(LearningLessonAdminSchema.omit({ steps: true })),
      }),
    ),
  },
);
export type LearningCourseComposition = z.infer<
  typeof LearningCourseCompositionSchema
>;

export const LearningSchoolListSchema = z.strictObject({
  data: z.array(LearningSchoolAdminSchema),
});
export type LearningSchoolList = z.infer<typeof LearningSchoolListSchema>;
export const LearningCourseListSchema = z.strictObject({
  data: z.array(LearningCourseAdminSchema),
});
export type LearningCourseList = z.infer<typeof LearningCourseListSchema>;

/** EARS-9 — a preset as data. */
export const LearningPresetSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  values: LearningSettingValuesSchema,
  version: z.number().int(),
});
export type LearningPreset = z.infer<typeof LearningPresetSchema>;
export const LearningPresetListSchema = z.strictObject({
  data: z.array(LearningPresetSchema),
});
export type LearningPresetList = z.infer<typeof LearningPresetListSchema>;

/** EARS-5 / EARS-29 — the effective rules of a scope; `layerVersion` 0 = no row yet. */
export const LearningScopeRulesSchema = z.strictObject({
  scopeKind: LearningScopeKindSchema,
  scopeId: z.string(),
  layerVersion: z.number().int(),
  appliedPreset: z.string().nullable(),
  /** This layer's own values (the overrides set here). */
  values: LearningSettingValuesSchema,
  effective: z.array(LearningResolvedSettingSchema),
});
export type LearningScopeRules = z.infer<typeof LearningScopeRulesSchema>;
