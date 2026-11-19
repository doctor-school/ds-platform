import type { LearningCourseProgress } from "@ds/schemas";
import type { LearningCourseModel } from "../model.js";
import type { LearningEvaluation } from "./evaluator.js";

// 023 EARS-3 (023-design §4) — a doctor's state of one course on a school
// card, derived from the 024 evaluator's result; no percent is stored or sent.

/**
 * `done` = the evaluator's course status; `started` = any done step, or a
 * current step that is not the course's first; else `not-started`.
 */
export function courseProgress(
  course: LearningCourseModel,
  evaluation: Pick<LearningEvaluation, "states" | "current">,
): LearningCourseProgress {
  if (evaluation.states.get(course.id)?.status === "done") return "done";
  const steps = course.modules.flatMap((m) => m.lessons.flatMap((l) => l.steps));
  if (steps.some((s) => evaluation.states.get(s.id)?.status === "done"))
    return "started";
  const current = evaluation.current?.stepId;
  if (current !== undefined && current !== steps[0]?.id) return "started";
  return "not-started";
}

/**
 * WHILE the course is `started`, the course-wide ordinal (from 1) of the
 * lesson holding the doctor's current step — the card's «Продолжить — урок N
 * →» (023-design §4); null otherwise.
 */
export function nextLessonNumber(
  course: LearningCourseModel,
  evaluation: Pick<LearningEvaluation, "states" | "current">,
): number | null {
  const lessonId = evaluation.current?.lessonId;
  if (lessonId === undefined || courseProgress(course, evaluation) !== "started")
    return null;
  const lessons = course.modules.flatMap((m) => m.lessons);
  const i = lessons.findIndex((l) => l.id === lessonId);
  return i < 0 ? null : i + 1;
}
