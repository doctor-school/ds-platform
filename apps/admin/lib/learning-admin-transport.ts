"use client";

import type { LearningAdminTransport } from "@ds/learning/admin";
import type {
  LearningCourseAdmin,
  LearningCourseComposition,
  LearningCourseList,
  LearningLessonAdmin,
  LearningModuleAdmin,
  LearningPreset,
  LearningPresetList,
  LearningRuleChangePreview,
  LearningSchoolAdmin,
  LearningSchoolAdminDetail,
  LearningScopeRules,
  LearningStepAdmin,
} from "@ds/schemas";
import {
  dataProvider,
  learningUrl,
  putLearningStepMedia,
} from "@/providers/data-provider";

/**
 * 024 (#4011) — the admin host's implementation of the `@ds/learning/admin`
 * port over this app's one BFF transport: every command rides
 * `dataProvider.custom` (CSRF double-submit, a fresh `Idempotency-Key` per call,
 * `If-Match` from the `version` the screen passes), the step file rides the
 * multipart helper next to it, and a refusal is the provider's 012 problem
 * body, which the package's screens read.
 */

type Method = "get" | "post" | "put" | "patch" | "delete";

async function call<T>(
  url: string,
  method: Method,
  payload?: unknown,
  version?: number,
): Promise<T> {
  const { data } = await dataProvider.custom!({
    url,
    method,
    ...(payload === undefined ? {} : { payload: payload as object }),
    ...(version === undefined ? {} : { meta: { version } }),
  });
  return data as T;
}

/** The course list of the learning section (`GET …/courses`). */
export async function listLearningCourses() {
  return (await call<LearningCourseList>(learningUrl.courses(), "get")).data;
}

/** 023 EARS-26 — a new (draft) school through the 024 admin create. */
export function createLearningSchool(body: {
  directionId: string;
  leadExpertId: string;
  projectId: string;
  title: string;
  slug: string;
}) {
  return call<LearningSchoolAdmin>(learningUrl.schools(), "post", body);
}

export const learningAdminTransport: LearningAdminTransport = {
  // 023 EARS-26, EARS-27 (#4018)
  school: (id) => call<LearningSchoolAdminDetail>(learningUrl.school(id), "get"),
  schoolCourses: async (id) =>
    (await call<LearningCourseList>(learningUrl.schoolCourses(id), "get")).data,
  updateSchool: (id, body, version) =>
    call<LearningSchoolAdmin>(learningUrl.school(id), "patch", body, version),
  publishSchool: (id, version) =>
    call<LearningSchoolAdmin>(
      learningUrl.schoolState(id, "publish"),
      "post",
      undefined,
      version,
    ),
  unpublishSchool: (id, version) =>
    call<LearningSchoolAdmin>(
      learningUrl.schoolState(id, "unpublish"),
      "post",
      undefined,
      version,
    ),
  reorderCourses: (id, courseIds, version) =>
    call<LearningSchoolAdmin>(
      learningUrl.courseOrder(id),
      "put",
      { courseIds },
      version,
    ),
  createCourse: (body) =>
    call<LearningCourseAdmin>(learningUrl.courses(), "post", body),
  updateCourse: (id, body, version) =>
    call<LearningCourseAdmin>(learningUrl.course(id), "patch", body, version),
  publishCourse: (id, version) =>
    call<LearningCourseAdmin>(
      learningUrl.courseState(id, "publish"),
      "post",
      undefined,
      version,
    ),
  unpublishCourse: (id, version) =>
    call<LearningCourseAdmin>(
      learningUrl.courseState(id, "unpublish"),
      "post",
      undefined,
      version,
    ),
  reorderModules: (id, moduleIds, version) =>
    call<LearningCourseAdmin>(
      learningUrl.moduleOrder(id),
      "put",
      { moduleIds },
      version,
    ),
  updateModule: (id, body, version) =>
    call<LearningModuleAdmin>(learningUrl.module(id), "patch", body, version),
  // 024
  course: (id) => call<LearningCourseComposition>(learningUrl.course(id), "get"),
  createModule: (body) =>
    call<LearningModuleAdmin>(learningUrl.modules(), "post", body),
  createLesson: (body) =>
    call<LearningLessonAdmin>(learningUrl.lessons(), "post", body),
  lesson: (id) => call<LearningLessonAdmin>(learningUrl.lesson(id), "get"),
  publishLesson: (id, version) =>
    call<LearningLessonAdmin>(
      learningUrl.lessonState(id, "publish"),
      "post",
      undefined,
      version,
    ),
  unpublishLesson: (id, version) =>
    call<LearningLessonAdmin>(
      learningUrl.lessonState(id, "unpublish"),
      "post",
      undefined,
      version,
    ),
  reorderSteps: (lessonId, stepIds, version) =>
    call<LearningLessonAdmin>(
      learningUrl.stepOrder(lessonId),
      "put",
      { stepIds },
      version,
    ),
  createStep: (body) => call<LearningStepAdmin>(learningUrl.steps(), "post", body),
  setStepSource: (id, body, version) =>
    call<LearningStepAdmin>(learningUrl.stepSource(id), "put", body, version),
  setStepMedia: (id, file, version) =>
    putLearningStepMedia<LearningStepAdmin>(id, file, version),
  removeStep: (id, version) =>
    call<LearningStepAdmin>(learningUrl.step(id), "delete", undefined, version),
  presets: async () =>
    (await call<LearningPresetList>(learningUrl.presets(), "get")).data,
  rules: (kind, id) =>
    call<LearningScopeRules>(learningUrl.rules(kind, id), "get"),
  applyPreset: (kind, id, presetId, layerVersion, earnedProgress) =>
    call<LearningScopeRules>(
      learningUrl.applyPreset(kind, id),
      "post",
      earnedProgress ? { presetId, earnedProgress } : { presetId },
      layerVersion,
    ),
  setRules: (kind, id, body, layerVersion) =>
    call<LearningScopeRules>(learningUrl.rules(kind, id), "put", body, layerVersion),
  previewRules: (kind, id, values) =>
    call<LearningRuleChangePreview>(learningUrl.rulesPreview(kind, id), "post", {
      values,
    }),
  updatePreset: (id, values, version) =>
    call<LearningPreset>(learningUrl.preset(id), "put", { values }, version),
};
