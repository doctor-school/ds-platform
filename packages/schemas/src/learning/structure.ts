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
    { readonly media: LearningStepMediaRule | null; readonly providerSource: boolean }
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

export const CreateLearningSchoolRequestSchema = z.strictObject({
  directionId: z.uuid(),
  leadExpertId: z.uuid(),
  projectId: z.uuid(),
  slug,
  title,
});
export type CreateLearningSchoolRequest = z.infer<
  typeof CreateLearningSchoolRequestSchema
>;

/** EARS-1 — a course always names its school. */
export const CreateLearningCourseRequestSchema = z.strictObject({
  schoolId: z.uuid(),
  projectId: z.uuid(),
  slug,
  title,
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

// ── Admin read models ───────────────────────────────────────────────────────

export const LearningSchoolAdminSchema = z.strictObject({
  id: z.uuid(),
  directionId: z.uuid(),
  leadExpertId: z.uuid(),
  projectId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  state: LearningStateSchema,
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
