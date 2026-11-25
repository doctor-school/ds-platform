import {
  directions,
  experts,
  learningCourses,
  learningFacts,
  learningLessons,
  learningModules,
  learningOptions,
  learningPresets,
  learningQuestions,
  learningRuleChanges,
  learningRuleLayers,
  learningSchools,
  learningSteps,
  expertPubliclyVisible,
  organisations,
  type LearningCourseRow,
  type LearningSchoolRow,
  type LearningLessonRow,
  type LearningModuleRow,
  type LearningStepRow,
} from "@ds/db";
import type {
  LearningElementType,
  LearningScopeKind,
  LearningSettingValues,
} from "@ds/schemas";
import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";
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
  const [loaded] = await loadCourseTrees(db, [course], doctorView);
  return loaded!;
}

/**
 * The trees of several courses in three reads (modules, lessons, steps), in
 * the order given — the 023 school read loads all its courses at once
 * (023-design §4 «One batched read»).
 */
export async function loadCourseTrees(
  db: Handle,
  courses: readonly LearningCourseRow[],
  doctorView: boolean,
): Promise<LoadedCourse[]> {
  if (courses.length === 0) return [];
  const modules = await db
    .select()
    .from(learningModules)
    .where(
      inArray(
        learningModules.courseId,
        courses.map((c) => c.id),
      ),
    )
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

  return courses.map((course) => {
    const ownModules = modules.filter((m) => m.courseId === course.id);
    const ownModuleIds = new Set(ownModules.map((m) => m.id));
    const ownLessons = lessons.filter((l) => ownModuleIds.has(l.moduleId));
    const ownLessonIds = new Set(ownLessons.map((l) => l.id));
    const ownSteps = steps.filter((s) => ownLessonIds.has(s.lessonId));
    const model: LearningCourseModel = {
      id: course.id,
      schoolId: course.schoolId,
      modules: ownModules
        .map((m) => ({
          id: m.id,
          title: m.title,
          lessons: ownLessons
            .filter((l) => l.moduleId === m.id)
            .map((l) => ({
              id: l.id,
              title: l.title,
              steps: ownSteps.filter((s) => s.lessonId === l.id).map(toStepModel),
            })),
        }))
        .filter((m) => !doctorView || m.lessons.length > 0),
    };
    return {
      row: course,
      model,
      modules: ownModules,
      lessons: ownLessons,
      steps: ownSteps,
    };
  });
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
  const [facts] = await loadFactsOfCourses(db, personId, [loaded]);
  return facts!;
}

/**
 * A doctor's facts on several courses in one read, split per course in the
 * order given (023-design §4 «One batched read»).
 */
export async function loadFactsOfCourses(
  db: Handle,
  personId: string,
  courses: readonly LoadedCourse[],
): Promise<LearningFactModel[][]> {
  if (courses.length === 0) return [];
  const records = await loadFactRecords(db, [personId], courses);
  const changes = await requireAgainChanges(db, courses);
  return courses.map((loaded, i) =>
    countingFacts(records.get(personId)?.[i] ?? [], loaded, changes),
  );
}

/** A stored fact with the instant it happened (EARS-31 compares it with later rule changes). */
export interface LearningFactRecord {
  fact: LearningFactModel;
  occurredAt: Date;
}

/** EARS-31 — a «require again» rule change: it re-judges every earlier kept credit it covers. */
export interface LearningRequireAgainChange {
  kind: LearningScopeKind;
  scopeId: string;
  at: Date;
}

/**
 * Several doctors' fact records on several courses in one read: per person,
 * one array per course in the order given.
 */
export async function loadFactRecords(
  db: Handle,
  personIds: readonly string[],
  courses: readonly LoadedCourse[],
): Promise<Map<string, LearningFactRecord[][]>> {
  const out = new Map<string, LearningFactRecord[][]>();
  if (personIds.length === 0 || courses.length === 0) return out;
  const owner = new Map<string, number>();
  courses.forEach((loaded, i) => {
    for (const id of [
      loaded.row.id,
      ...loaded.modules.map((m) => m.id),
      ...loaded.lessons.map((l) => l.id),
      ...loaded.steps.map((s) => s.id),
    ])
      owner.set(id, i);
  });
  const stepIds = courses.flatMap((c) => c.steps.map((s) => s.id));
  const itemIds = [...owner.keys()];
  const rows = await db
    .select({
      personId: learningFacts.personId,
      kind: learningFacts.kind,
      stepId: learningFacts.stepId,
      itemRef: learningFacts.itemRef,
      data: learningFacts.data,
      occurredAt: learningFacts.occurredAt,
    })
    .from(learningFacts)
    .where(
      and(
        inArray(learningFacts.personId, [...personIds]),
        or(
          stepIds.length > 0
            ? inArray(learningFacts.stepId, stepIds)
            : undefined,
          inArray(learningFacts.itemRef, itemIds),
        ),
      ),
    );
  for (const id of personIds) out.set(id, courses.map(() => []));
  for (const r of rows) {
    const i =
      (r.stepId !== null ? owner.get(r.stepId) : undefined) ??
      (r.itemRef !== null ? owner.get(r.itemRef) : undefined);
    if (i === undefined) continue;
    const fact = toFact(r);
    if (fact) out.get(r.personId)![i]!.push({ fact, occurredAt: r.occurredAt });
  }
  return out;
}

/** EARS-31 — the «require again» rule changes on any scope these courses resolve through. */
export async function requireAgainChanges(
  db: Handle,
  courses: readonly LoadedCourse[],
): Promise<LearningRequireAgainChange[]> {
  if (courses.length === 0) return [];
  const ids = courses.flatMap((c) => [
    c.row.schoolId,
    c.row.id,
    ...c.modules.map((m) => m.id),
    ...c.lessons.map((l) => l.id),
    ...c.steps.map((s) => s.id),
  ]);
  const rows = await db
    .select({
      kind: learningRuleChanges.scopeKind,
      scopeId: learningRuleChanges.scopeId,
      at: learningRuleChanges.at,
    })
    .from(learningRuleChanges)
    .where(
      and(
        eq(learningRuleChanges.earnedProgress, "require-again"),
        or(
          eq(learningRuleChanges.scopeKind, "platform"),
          inArray(learningRuleChanges.scopeId, ids),
        ),
      ),
    );
  return rows.map((r) => ({
    kind: r.kind as LearningScopeKind,
    scopeId: r.scopeId,
    at: r.at,
  }));
}

/**
 * EARS-31 — whether a rule change on a scope bears on an item's completion:
 * the scope holds the item (an ancestor or the item itself) or sits inside it
 * (a step or lesson of a kept module or course).
 */
export function scopeCovers(
  loaded: LoadedCourse,
  scope: { kind: LearningScopeKind; scopeId: string },
  itemId: string,
): boolean {
  if (scope.kind === "platform") return true;
  if (scope.kind === "school") return loaded.row.schoolId === scope.scopeId;
  const parent = new Map<string, string>();
  for (const m of loaded.modules) parent.set(m.id, loaded.row.id);
  for (const l of loaded.lessons) parent.set(l.id, l.moduleId);
  for (const st of loaded.steps) parent.set(st.id, st.lessonId);
  const chain = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let at: string | undefined = id; at; at = parent.get(at)) out.add(at);
    return out;
  };
  return chain(itemId).has(scope.scopeId) || chain(scope.scopeId).has(itemId);
}

/**
 * EARS-31 — the facts that count: a `completion-kept` credit counts only while
 * no LATER «require again» rule change covers its item. No fact is changed or
 * removed; a re-judged credit is simply not handed to the evaluator.
 */
export function countingFacts(
  records: readonly LearningFactRecord[],
  loaded: LoadedCourse,
  changes: readonly LearningRequireAgainChange[],
): LearningFactModel[] {
  const out: LearningFactModel[] = [];
  for (const { fact, occurredAt } of records) {
    if (
      fact.kind === "completion-kept" &&
      changes.some(
        (c) =>
          c.at.getTime() > occurredAt.getTime() &&
          scopeCovers(loaded, c, fact.itemId),
      )
    )
      continue;
    out.push(fact);
  }
  return out;
}

function toFact(r: {
  kind: string;
  stepId: string | null;
  itemRef: string | null;
  data: unknown;
}): LearningFactModel | null {
  const data = (r.data ?? {}) as Record<string, unknown>;
  switch (r.kind) {
    case "position":
      return r.stepId
        ? {
            kind: "position",
            stepId: r.stepId,
            positionSec: Number(data["positionSec"] ?? 0),
            ...(typeof data["mediaDurationSec"] === "number"
              ? { mediaDurationSec: data["mediaDurationSec"] }
              : {}),
          }
        : null;
    case "opened":
      return r.stepId ? { kind: "opened", stepId: r.stepId } : null;
    case "attempt-submitted":
      return r.stepId
        ? {
            kind: "attempt-submitted",
            stepId: r.stepId,
            score: Number(data["score"] ?? 0),
          }
        : null;
    case "manual-mark":
    case "completion-kept":
    case "test-out-passed":
      return r.itemRef ? { kind: r.kind, itemId: r.itemRef } : null;
    case "club-attended":
      return r.itemRef ? { kind: "club-attended", moduleId: r.itemRef } : null;
    default:
      return null;
  }
}

/** EARS-13 — each test's live question count, in one read (tests with none are absent). */
export async function questionCounts(
  db: Handle,
  testIds: readonly string[],
): Promise<Map<string, number>> {
  if (testIds.length === 0) return new Map();
  const rows = await db
    .select({ testId: learningQuestions.testId, n: count() })
    .from(learningQuestions)
    .where(
      and(
        inArray(learningQuestions.testId, [...testIds]),
        isNull(learningQuestions.removedAt),
      ),
    )
    .groupBy(learningQuestions.testId);
  return new Map(rows.map((r) => [r.testId, Number(r.n)]));
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

/**
 * EARS-14 — the course's direction, school and the school's leading expert, on
 * the public read: the expert only when publicly visible (012 — published, not
 * retired, not editorially removed) and the direction only when published and
 * not retired; otherwise that part is null and the course still reads.
 */
export async function coursePlaces(db: Handle, schoolId: string) {
  const [row] = await db
    .select({
      direction: { slug: directions.slug, title: directions.title },
      school: { slug: learningSchools.slug, title: learningSchools.title },
      expert: {
        slug: experts.slug,
        familyName: experts.familyName,
        givenName: experts.givenName,
        patronymic: experts.patronymic,
        professionalRole: experts.professionalRole,
        credentials: experts.credentials,
        affiliation: experts.affiliation,
        photoRef: experts.photoRef,
      },
    })
    .from(learningSchools)
    .leftJoin(
      directions,
      and(
        eq(directions.id, learningSchools.directionId),
        eq(directions.status, "published"),
        isNull(directions.deletedAt),
      ),
    )
    .leftJoin(
      experts,
      and(eq(experts.id, learningSchools.leadExpertId), expertPubliclyVisible),
    )
    .where(eq(learningSchools.id, schoolId));
  return row;
}

/** 023 EARS-3 — a school by its slug, whatever its state. */
export async function schoolBySlug(
  db: Handle,
  slug: string,
): Promise<LearningSchoolRow | undefined> {
  const [row] = await db
    .select()
    .from(learningSchools)
    .where(eq(learningSchools.slug, slug));
  return row;
}

/** 023 EARS-3 — the school's published courses in school order. */
export async function publishedCoursesOfSchool(
  db: Handle,
  schoolId: string,
): Promise<LearningCourseRow[]> {
  return db
    .select()
    .from(learningCourses)
    .where(
      and(
        eq(learningCourses.schoolId, schoolId),
        eq(learningCourses.state, "published"),
      ),
    )
    .orderBy(
      asc(learningCourses.position),
      asc(learningCourses.createdAt),
      asc(learningCourses.id),
    );
}

/**
 * 023 EARS-22 — the 032 names of the given partner organisations, only for
 * an organisation that is published, not retired and shows its name publicly.
 */
export async function publicPartnerNames(
  db: Handle,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: organisations.id, title: organisations.title })
    .from(organisations)
    .where(
      and(
        inArray(organisations.id, [...new Set(ids)]),
        eq(organisations.status, "published"),
        isNull(organisations.deletedAt),
        eq(organisations.publicNameVisible, true),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.title]));
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
