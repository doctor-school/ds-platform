import { describe, expect, it } from "vitest";
import {
  buildGoldenLearningVolume,
  golden,
  GOLDEN_VOLUME_FACT_COURSES,
  goldenLearningCompletions,
} from "@ds/db/seed/golden";
import {
  courseProgress,
  evaluateCourse,
  LEARNING_PLATFORM_SCOPE_ID,
  LEARNING_PLATFORM_SEED,
  LearningLayers,
  nextLessonNumber,
  publishRequirements,
  validateSettingValues,
  validateStepPayload,
  type LearningCourseModel,
  type LearningFactModel,
  type LearningSettingValues,
  type LearningStepModel,
} from "./index.js";

// 023 EARS-5 (#4017) — the golden schools at volume
// (`packages/db/src/seed/golden/learning-volume.ts`) are written straight into
// `ds_golden`, so they are held here against the admin path's rules: the own
// rule layer passes the layer validator, every lesson meets the EARS-4 publish
// requirements under it, and the golden doctor's facts read as the school
// screen shows them — two started courses («Продолжить — урок 3 / 1») and one
// done.

const rows = buildGoldenLearningVolume(new Date("2026-01-15T12:00:00.000Z"));

/**
 * The admin-written payload of a step: a test's is rebuilt from its rows
 * (`storedTestPayload`), as `golden-course.test.ts` does — the long paths
 * (#4172) close every lesson with an exit test.
 */
function storedPayload(step: (typeof rows.learningSteps)[number]): unknown {
  if (step.type !== "test") return step.payload;
  return {
    kind: (step.payload as Record<string, unknown>)["kind"],
    questions: rows.learningQuestions
      .filter((q) => q.testId === step.id)
      .sort((a, b) => a.position - b.position)
      .map((q) => ({
        text: q.text,
        options: rows.learningOptions
          .filter((o) => o.questionId === q.id)
          .sort((a, b) => a.position - b.position)
          .map((o) => ({ text: o.text, correct: o.correct })),
      })),
  };
}

function courseModel(courseId: string): LearningCourseModel {
  const course = rows.learningCourses.find((c) => c.id === courseId)!;
  return {
    id: courseId,
    schoolId: course.schoolId,
    modules: rows.learningModules
      .filter((m) => m.courseId === courseId)
      .map((m) => ({
        id: m.id!,
        title: m.title,
        lessons: rows.learningLessons
          .filter((l) => l.moduleId === m.id)
          .sort((a, b) => a.position - b.position)
          .map((l) => ({
            id: l.id!,
            title: l.title,
            steps: rows.learningSteps
              .filter((s) => s.lessonId === l.id)
              .sort((a, b) => a.position - b.position)
              .map((s): LearningStepModel => ({
                id: s.id!,
                type: s.type as LearningStepModel["type"],
                title: s.title,
                durationMin: s.durationMin,
                payload: s.payload as Record<string, unknown>,
              })),
          })),
      })),
  };
}

function layersOf(courseId: string): LearningLayers {
  const own = rows.learningOwnRuleLayers.find((l) => l.scopeId === courseId)!;
  return new LearningLayers([
    {
      scopeKind: "platform",
      scopeId: LEARNING_PLATFORM_SCOPE_ID,
      values: LEARNING_PLATFORM_SEED,
      preset: null,
    },
    {
      scopeKind: "course",
      scopeId: courseId,
      values: own.values as LearningSettingValues,
      preset: null,
    },
  ]);
}

const coursesOf = (schoolId: string) =>
  rows.learningCourses
    .filter((c) => c.schoolId === schoolId)
    .sort((a, b) => a.position! - b.position!);

describe("023 EARS-5 (#4017) — the golden schools at volume hold the admin path's rules", () => {
  it("every course's own layer passes the layer validator at the course level", () => {
    for (const layer of rows.learningOwnRuleLayers) {
      const model = courseModel(layer.scopeId);
      const steps = model.modules.flatMap((m) =>
        m.lessons.flatMap((l) => l.steps),
      );
      expect(
        validateSettingValues(layer.values, "course", {
          stepIds: new Set(steps.map((s) => s.id)),
          moduleIds: new Set(model.modules.map((m) => m.id)),
          testStepIds: new Set(),
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it("every published lesson meets the EARS-4 publish requirements under the course's own layer", () => {
    for (const course of rows.learningCourses) {
      const model = courseModel(course.id!);
      const layers = layersOf(course.id!);
      for (const module of model.modules) {
        for (const lesson of module.lessons) {
          const steps = rows.learningSteps.filter(
            (s) => s.lessonId === lesson.id,
          );
          for (const s of steps)
            expect(validateStepPayload(s.type, storedPayload(s))).toMatchObject(
              {
                ok: true,
              },
            );
          const issues = publishRequirements(
            lesson,
            layers,
            {
              school: course.schoolId,
              course: course.id!,
              module: module.id,
              lesson: lesson.id,
            },
            (id) => {
              const s = steps.find((x) => x.id === id);
              return s && storedPayload(s);
            },
            (id) => steps.find((s) => s.id === id)?.mediaRef != null,
            (id) => steps.find((s) => s.id === id)?.embedRef != null,
          );
          expect(issues, `${course.slug} ${lesson.title}`).toEqual([]);
        }
      }
    }
  });

  it("the golden doctor's facts read as two started courses (урок 3, урок 1) and one done, the rest not started", () => {
    const doctor = golden.doctors.verifiedCardiologist.id;
    for (const school of golden.learning.volumeSchools.filter(
      (s) => s.courseCount > 6,
    )) {
      const courses = coursesOf(school.id);
      courses.forEach((course, c) => {
        const model = courseModel(course.id!);
        const stepIds = new Set(
          model.modules.flatMap((m) =>
            m.lessons.flatMap((l) => l.steps.map((s) => s.id)),
          ),
        );
        const facts: LearningFactModel[] = rows.learningFacts
          .filter((f) => f.personId === doctor && stepIds.has(f.stepId!))
          .map((f) =>
            f.kind === "opened"
              ? { kind: "opened", stepId: f.stepId! }
              : {
                  kind: "position",
                  stepId: f.stepId!,
                  positionSec: Number(
                    (f.data as Record<string, unknown>)["positionSec"],
                  ),
                },
          );
        const { evaluation } = evaluateCourse({
          course: model,
          layers: layersOf(course.id!),
          facts,
          now: new Date("2026-03-01T00:00:00Z"),
        });
        const state = courseProgress(model, evaluation);
        const next = nextLessonNumber(model, evaluation);
        const F = GOLDEN_VOLUME_FACT_COURSES;
        const expected =
          c === F.midway
            ? ["started", 3]
            : c === F.begun
              ? ["started", 1]
              : c === F.done
                ? ["done", null]
                : ["not-started", null];
        expect([state, next], `${school.slug} course ${c + 1}`).toEqual(
          expected,
        );
      });
    }
  });

  it("course 6 is done by opening its one download, course 2 stays at lesson 1 — the live spec's fresh-doctor journey", () => {
    for (const school of golden.learning.volumeSchools.filter(
      (s) => s.courseCount > 6,
    )) {
      const courses = coursesOf(school.id);
      for (const [c, expected] of [
        [1, ["started", 1]],
        [5, ["done", null]],
      ] as const) {
        const model = courseModel(courses[c]!.id!);
        const download = model.modules[0]!.lessons[0]!.steps.find(
          (s) => s.type === "download",
        )!;
        const { evaluation } = evaluateCourse({
          course: model,
          layers: layersOf(model.id),
          facts: [{ kind: "opened", stepId: download.id }],
          now: new Date("2026-03-01T00:00:00Z"),
        });
        expect([
          courseProgress(model, evaluation),
          nextLessonNumber(model, evaluation),
        ]).toEqual(expected);
      }
    }
  });

  // #4172 — the golden ledger accrues `lesson.completed` / `module.completed`
  // for these completions; the projector sends exactly what the evaluator
  // marks done, so the two must agree item for item.
  it("the ledger's completions are exactly the lessons and modules the evaluator marks done", () => {
    const doctor = golden.doctors.verifiedCardiologist.id;
    const credited = new Set(
      goldenLearningCompletions(
        { ...rows, learningRuleLayers: rows.learningOwnRuleLayers },
        [doctor],
      ).map((c) => c.id),
    );
    const done = new Set<string>();
    for (const course of rows.learningCourses) {
      const model = courseModel(course.id!);
      const stepIds = new Set(
        model.modules.flatMap((m) =>
          m.lessons.flatMap((l) => l.steps.map((s) => s.id)),
        ),
      );
      const facts: LearningFactModel[] = rows.learningFacts
        .filter((f) => f.personId === doctor && stepIds.has(f.stepId!))
        .map((f): LearningFactModel =>
          f.kind === "opened"
            ? { kind: "opened", stepId: f.stepId! }
            : f.kind === "attempt-submitted"
              ? {
                  // #4012 — the long paths' submitted results.
                  kind: "attempt-submitted",
                  stepId: f.stepId!,
                  score: Number((f.data as Record<string, unknown>)["score"]),
                }
              : {
                  kind: "position",
                  stepId: f.stepId!,
                  positionSec: Number(
                    (f.data as Record<string, unknown>)["positionSec"],
                  ),
                },
        );
      if (facts.length === 0) continue;
      const { evaluation } = evaluateCourse({
        course: model,
        layers: layersOf(course.id!),
        facts,
        now: new Date("2026-03-01T00:00:00Z"),
      });
      for (const [id, state] of evaluation.states) {
        const kind = evaluation.kinds.get(id);
        if (
          state.status === "done" &&
          (kind === "lesson" || kind === "module")
        )
          done.add(id);
      }
    }
    expect(credited.size).toBeGreaterThan(0);
    expect([...credited].sort()).toEqual([...done].sort());
  });
});
