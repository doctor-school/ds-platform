import type {
  CreateLearningCourseRequest,
  CreateLearningLessonRequest,
  CreateLearningModuleRequest,
  CreateLearningStepRequest,
  LearningCourseAdmin,
  LearningCourseComposition,
  LearningLessonAdmin,
  LearningModuleAdmin,
  LearningEarnedProgress,
  LearningPreset,
  LearningRuleChangePreview,
  LearningSchoolAdmin,
  LearningSchoolAdminDetail,
  LearningScopeKind,
  LearningScopeRules,
  LearningStepAdmin,
  LearningSettingValues,
  SetLearningScopeRulesRequest,
  SetLearningStepSourceRequest,
  UpdateLearningCourseRequest,
  UpdateLearningModuleRequest,
  UpdateLearningSchoolRequest,
} from "@ds/schemas";

// 024 design §1 `./admin` — the port the staff screens call. The admin host
// implements it over its own BFF transport (CSRF double-submit, a fresh
// `Idempotency-Key` per write, `If-Match` from the `version` passed here), so
// the package never owns an admin session and the screens stay testable with a
// fake. Every write after a create names the version the screen rendered from.

export interface LearningAdminTransport {
  // ── 023 EARS-26, EARS-27 — the school and course structure editor ────────
  /** `GET /v1/admin/learning/schools/{id}` — the school with its interest count. */
  school(schoolId: string): Promise<LearningSchoolAdminDetail>;
  /** `GET /v1/admin/learning/courses?schoolId=` — the school's courses in school order. */
  schoolCourses(schoolId: string): Promise<LearningCourseAdmin[]>;
  updateSchool(
    schoolId: string,
    body: UpdateLearningSchoolRequest,
    version: number,
  ): Promise<LearningSchoolAdmin>;
  publishSchool(schoolId: string, version: number): Promise<LearningSchoolAdmin>;
  unpublishSchool(
    schoolId: string,
    version: number,
  ): Promise<LearningSchoolAdmin>;
  /** `PUT …/schools/{id}/course-order` — under the school's version. */
  reorderCourses(
    schoolId: string,
    courseIds: string[],
    version: number,
  ): Promise<LearningSchoolAdmin>;
  /** A new course, placed last in its school; the server defaults its other EARS-1 data. */
  createCourse(
    body: Pick<
      CreateLearningCourseRequest,
      "schoolId" | "projectId" | "slug" | "title"
    >,
  ): Promise<LearningCourseAdmin>;
  updateCourse(
    courseId: string,
    body: UpdateLearningCourseRequest,
    version: number,
  ): Promise<LearningCourseAdmin>;
  publishCourse(courseId: string, version: number): Promise<LearningCourseAdmin>;
  unpublishCourse(
    courseId: string,
    version: number,
  ): Promise<LearningCourseAdmin>;
  /** `PUT …/courses/{id}/module-order` — under the course's version. */
  reorderModules(
    courseId: string,
    moduleIds: string[],
    version: number,
  ): Promise<LearningCourseAdmin>;
  updateModule(
    moduleId: string,
    body: UpdateLearningModuleRequest,
    version: number,
  ): Promise<LearningModuleAdmin>;
  // ── 024 ──────────────────────────────────────────────────────────────────
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
