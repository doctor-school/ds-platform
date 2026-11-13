import {
  learningCourses,
  learningFacts,
  learningLessons,
  learningModules,
  learningOptions,
  learningPresets,
  learningQuestions,
  learningRuleLayers,
  learningSteps,
  type LearningCourseRow,
  type LearningLessonRow,
  type LearningModuleRow,
  type LearningStepRow,
} from "@ds/db";
import type {
  LearningElementType,
  LearningScopeKind,
  LearningSettingValues,
} from "@ds/schemas";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  LEARNING_PLATFORM_SCOPE_ID,
  type LearningCourseModel,
  type LearningFactModel,
  type LearningLayer,
  type LearningStepModel,
} from "../model.js";
import { LearningLayers } from "../rules/resolver.js";
import type { LearningDb, LearningTx } from "./deps.js";

// 024 — the reads the services share: a course as the evaluator's tree, the
// rule layers that bear on it and a doctor's facts in it.

type Handle = LearningDb | LearningTx;

export interface LoadedCourse {
  row: LearningCourseRow;
  model: LearningCourseModel;
  modules: LearningModuleRow[];
  lessons: LearningLessonRow[];
  steps: LearningStepRow[];
}

/**
 * The course tree. `doctorView` keeps only published lessons and the modules
 * that hold one (EARS-4: an unpublished lesson is on no doctor read); removed
 * steps never appear.
 */
export async function loadCourseTree(
  db: Handle,
  course: LearningCourseRow,
  doctorView: boolean,
): Promise<LoadedCourse> {
  const modules = await db
    .select()
    .from(learningModules)
    .where(eq(learningModules.courseId, course.id))
    .orderBy(asc(learningModules.position), asc(learningModules.createdAt));
  const moduleIds = modules.map((m) => m.id);
  const lessons =
    moduleIds.length === 0
      ? []
      : await db
          .select()
          .from(learningLessons)
          .where(
            and(
              inArray(learningLessons.moduleId, moduleIds),
              doctorView ? eq(learningLessons.state, "published") : undefined,
            ),
          )
          .orderBy(
            asc(learningLessons.position),
            asc(learningLessons.createdAt),
          );
  const lessonIds = lessons.map((l) => l.id);
  const steps =
    lessonIds.length === 0
      ? []
      : await db
          .select()
          .from(learningSteps)
          .where(
            and(
              inArray(learningSteps.lessonId, lessonIds),
              isNull(learningSteps.removedAt),
            ),
          )
          .orderBy(asc(learningSteps.position), asc(learningSteps.createdAt));

  const model: LearningCourseModel = {
    id: course.id,
    schoolId: course.schoolId,
    modules: modules
      .map((m) => ({
        id: m.id,
        title: m.title,
        lessons: lessons
          .filter((l) => l.moduleId === m.id)
          .map((l) => ({
            id: l.id,
            title: l.title,
            steps: steps.filter((s) => s.lessonId === l.id).map(toStepModel),
          })),
      }))
      .filter((m) => !doctorView || m.lessons.length > 0),
  };
  return { row: course, model, modules, lessons, steps };
}

export function toStepModel(s: LearningStepRow): LearningStepModel {
  return {
    id: s.id,
    type: s.type as LearningElementType,
    title: s.title,
    durationMin: s.durationMin,
    payload: (s.payload ?? {}) as Record<string, unknown>,
  };
}

/** Every rule layer on the path of a course's items, the platform row included (EARS-5). */
export async function loadLayersFor(
  db: Handle,
  scopes: Array<{ kind: LearningScopeKind; id: string }>,
): Promise<LearningLayers> {
  const conditions = [
    and(
      eq(learningRuleLayers.scopeKind, "platform"),
      eq(learningRuleLayers.scopeId, LEARNING_PLATFORM_SCOPE_ID),
    ),
    ...scopes.map((s) =>
      and(
        eq(learningRuleLayers.scopeKind, s.kind),
        eq(learningRuleLayers.scopeId, s.id),
      ),
    ),
  ];
  const rows = await db
    .select({
      layer: learningRuleLayers,
      presetName: learningPresets.name,
      presetValues: learningPresets.values,
    })
    .from(learningRuleLayers)
    .leftJoin(
      learningPresets,
      eq(learningPresets.id, learningRuleLayers.appliedPresetId),
    )
    .where(or(...conditions));
  return new LearningLayers(
    rows.map((r) => toLayer(r.layer, r.presetName, r.presetValues)),
  );
}

export function toLayer(
  layer: typeof learningRuleLayers.$inferSelect,
  presetName: string | null,
  presetValues: unknown,
): LearningLayer {
  return {
    scopeKind: layer.scopeKind as LearningScopeKind,
    scopeId: layer.scopeId,
    values: layer.values as LearningSettingValues,
    preset: presetName,
    ...(presetValues
      ? { presetValues: presetValues as LearningSettingValues }
      : {}),
  };
}

/** The scopes of every item of a loaded course, for {@link loadLayersFor}. */
export function scopesOf(
  loaded: Pick<LoadedCourse, "row" | "modules" | "lessons" | "steps">,
) {
  return [
    { kind: "school" as const, id: loaded.row.schoolId },
    { kind: "course" as const, id: loaded.row.id },
    ...loaded.modules.map((m) => ({ kind: "module" as const, id: m.id })),
    ...loaded.lessons.map((l) => ({ kind: "lesson" as const, id: l.id })),
    ...loaded.steps.map((s) => ({ kind: "step" as const, id: s.id })),
  ];
}

/** A doctor's facts on a course's steps and items (024-design §2 «Facts»). */
export async function loadFacts(
  db: Handle,
  personId: string,
  loaded: LoadedCourse,
): Promise<LearningFactModel[]> {
  const stepIds = loaded.steps.map((s) => s.id);
  const itemIds = [
    loaded.row.id,
    ...loaded.modules.map((m) => m.id),
    ...loaded.lessons.map((l) => l.id),
    ...stepIds,
  ];
  const rows = await db
    .select({
      kind: learningFacts.kind,
      stepId: learningFacts.stepId,
      itemRef: learningFacts.itemRef,
      data: learningFacts.data,
    })
    .from(learningFacts)
    .where(
      and(
        eq(learningFacts.personId, personId),
        or(
          stepIds.length > 0
            ? inArray(learningFacts.stepId, stepIds)
            : undefined,
          inArray(learningFacts.itemRef, itemIds),
        ),
      ),
    );
  const facts: LearningFactModel[] = [];
  for (const r of rows) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    switch (r.kind) {
      case "position":
        if (r.stepId)
          facts.push({
            kind: "position",
            stepId: r.stepId,
            positionSec: Number(data["positionSec"] ?? 0),
          });
        break;
      case "opened":
        if (r.stepId) facts.push({ kind: "opened", stepId: r.stepId });
        break;
      case "attempt-submitted":
        if (r.stepId)
          facts.push({
            kind: "attempt-submitted",
            stepId: r.stepId,
            score: Number(data["score"] ?? 0),
          });
        break;
      case "manual-mark":
      case "completion-kept":
      case "test-out-passed":
        if (r.itemRef) facts.push({ kind: r.kind, itemId: r.itemRef });
        break;
      case "club-attended":
        if (r.itemRef)
          facts.push({ kind: "club-attended", moduleId: r.itemRef });
        break;
    }
  }
  return facts;
}

/** A test's live questions with their options, in order. */
export async function loadQuestions(db: Handle, testId: string) {
  const questions = await db
    .select()
    .from(learningQuestions)
    .where(
      and(
        eq(learningQuestions.testId, testId),
        isNull(learningQuestions.removedAt),
      ),
    )
    .orderBy(asc(learningQuestions.position));
  const options =
    questions.length === 0
      ? []
      : await db
          .select()
          .from(learningOptions)
          .where(
            inArray(
              learningOptions.questionId,
              questions.map((q) => q.id),
            ),
          )
          .orderBy(asc(learningOptions.position));
  return questions.map((q) => ({
    ...q,
    options: options.filter((o) => o.questionId === q.id),
  }));
}

export async function courseById(
  db: Handle,
  id: string,
): Promise<LearningCourseRow | undefined> {
  const [row] = await db
    .select()
    .from(learningCourses)
    .where(eq(learningCourses.id, id));
  return row;
}

export async function courseBySlug(
  db: Handle,
  slug: string,
): Promise<LearningCourseRow | undefined> {
  const [row] = await db
    .select()
    .from(learningCourses)
    .where(eq(learningCourses.slug, slug));
  return row;
}

/** The course a lesson / step / module belongs to. */
export async function courseOfModule(db: Handle, moduleId: string) {
  const [row] = await db
    .select({ course: learningCourses, module: learningModules })
    .from(learningModules)
    .innerJoin(
      learningCourses,
      eq(learningCourses.id, learningModules.courseId),
    )
    .where(eq(learningModules.id, moduleId));
  return row;
}

export async function courseOfLesson(db: Handle, lessonId: string) {
  const [row] = await db
    .select({
      course: learningCourses,
      module: learningModules,
      lesson: learningLessons,
    })
    .from(learningLessons)
    .innerJoin(
      learningModules,
      eq(learningModules.id, learningLessons.moduleId),
    )
    .innerJoin(
      learningCourses,
      eq(learningCourses.id, learningModules.courseId),
    )
    .where(eq(learningLessons.id, lessonId));
  return row;
}

export async function courseOfStep(db: Handle, stepId: string) {
  const [row] = await db
    .select({
      course: learningCourses,
      module: learningModules,
      lesson: learningLessons,
      step: learningSteps,
    })
    .from(learningSteps)
    .innerJoin(learningLessons, eq(learningLessons.id, learningSteps.lessonId))
    .innerJoin(
      learningModules,
      eq(learningModules.id, learningLessons.moduleId),
    )
    .innerJoin(
      learningCourses,
      eq(learningCourses.id, learningModules.courseId),
    )
    .where(eq(learningSteps.id, stepId));
  return row;
}
