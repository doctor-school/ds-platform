import type {
  CreateLearningLessonRequest,
  CreateLearningModuleRequest,
  CreateLearningStepRequest,
  LearningCourseComposition,
  LearningLessonAdmin,
  LearningModuleAdmin,
  LearningEarnedProgress,
  LearningPreset,
  LearningRuleChangePreview,
  LearningScopeKind,
  LearningScopeRules,
  LearningStepAdmin,
  LearningSettingValues,
  SetLearningScopeRulesRequest,
  SetLearningStepSourceRequest,
} from "@ds/schemas";

// 024 design §1 `./admin` — the port the staff screens call. The admin host
// implements it over its own BFF transport (CSRF double-submit, a fresh
// `Idempotency-Key` per write, `If-Match` from the `version` passed here), so
// the package never owns an admin session and the screens stay testable with a
// fake. Every write after a create names the version the screen rendered from.

export interface LearningAdminTransport {
  /** `GET /v1/admin/learning/courses/{id}` — modules → lessons (no steps). */
  course(courseId: string): Promise<LearningCourseComposition>;
  createModule(body: CreateLearningModuleRequest): Promise<LearningModuleAdmin>;
  createLesson(body: CreateLearningLessonRequest): Promise<LearningLessonAdmin>;
  lesson(lessonId: string): Promise<LearningLessonAdmin>;
  publishLesson(
    lessonId: string,
    version: number,
  ): Promise<LearningLessonAdmin>;
  unpublishLesson(
    lessonId: string,
    version: number,
  ): Promise<LearningLessonAdmin>;
  reorderSteps(
    lessonId: string,
    stepIds: string[],
    version: number,
  ): Promise<LearningLessonAdmin>;
  createStep(body: CreateLearningStepRequest): Promise<LearningStepAdmin>;
  setStepSource(
    stepId: string,
    body: SetLearningStepSourceRequest,
    version: number,
  ): Promise<LearningStepAdmin>;
  /** `PUT …/steps/{id}/media` — multipart, one `file` part. */
  setStepMedia(
    stepId: string,
    file: File,
    version: number,
  ): Promise<LearningStepAdmin>;
  removeStep(stepId: string, version: number): Promise<LearningStepAdmin>;
  presets(): Promise<LearningPreset[]>;
  rules(
    scopeKind: LearningScopeKind,
    scopeId: string,
  ): Promise<LearningScopeRules>;
  applyPreset(
    scopeKind: "school" | "course",
    scopeId: string,
    presetId: string,
    layerVersion: number,
    /** EARS-31 — on a once-published course; the server defaults to «keep». */
    earnedProgress?: LearningEarnedProgress,
  ): Promise<LearningScopeRules>;
  /**
   * `PUT …/rules/{scopeKind}/{scopeId}` — the scope's own values (EARS-29);
   * `earnedProgress` on a once-published course (EARS-31). `layerVersion` 0 =
   * no row yet.
   */
  setRules(
    scopeKind: LearningScopeKind,
    scopeId: string,
    body: SetLearningScopeRulesRequest,
    layerVersion: number,
  ): Promise<LearningScopeRules>;
  /** `POST …/rules/{scopeKind}/{scopeId}/preview` — the impact count; writes nothing (EARS-31). */
  previewRules(
    scopeKind: LearningScopeKind,
    scopeId: string,
    values: LearningSettingValues,
  ): Promise<LearningRuleChangePreview>;
  /** `PUT …/presets/{id}` — a preset's contents (EARS-29, `learning_rules_editor`). */
  updatePreset(
    presetId: string,
    values: LearningSettingValues,
    version: number,
  ): Promise<LearningPreset>;
}

/** The 012 problem body the host transport throws (its `TaxonomyHttpError`). */
export interface LearningAdminRefusal {
  statusCode?: number;
  errorCode?: string;
  message?: string;
  fieldErrors?: { path: string; message: string }[];
}

export function asRefusal(error: unknown): LearningAdminRefusal {
  return typeof error === "object" && error !== null
    ? (error as LearningAdminRefusal)
    : {};
}
