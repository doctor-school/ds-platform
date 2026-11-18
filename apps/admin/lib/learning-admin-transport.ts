"use client";

import type { LearningAdminTransport } from "@ds/learning/admin";
import type {
  LearningCourseComposition,
  LearningCourseList,
  LearningLessonAdmin,
  LearningModuleAdmin,
  LearningPresetList,
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

export const learningAdminTransport: LearningAdminTransport = {
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
  applyPreset: (kind, id, presetId, layerVersion) =>
    call<LearningScopeRules>(
      learningUrl.applyPreset(kind, id),
      "post",
      { presetId },
      layerVersion,
    ),
};
