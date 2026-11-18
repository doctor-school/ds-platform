import { describe, expect, it } from "vitest";
import {
  buildGoldenLearning,
  golden,
  GOLDEN_COURSE_PRESET_NAME,
  goldenCourseMemoPdf,
} from "@ds/db/seed/golden";
import {
  evaluateCourse,
  LEARNING_PLATFORM_SCOPE_ID,
  LEARNING_PLATFORM_SEED,
  LEARNING_PRESET_NAMES,
  LEARNING_PRESET_SEEDS,
  LearningLayers,
  publishRequirements,
  validateStepPayload,
  type LearningCourseModel,
  type LearningFactModel,
  type LearningStepModel,
} from "./index.js";

// #4059 — the golden course (`packages/db/src/seed/golden/learning.ts`) is
// written straight into `ds_golden`, so it is held here against the rules the
// admin API path would have run on the same course: every step payload passes
// its element type's schema, every lesson meets the EARS-4 publish
// requirements under the applied «Путь (Duolingo)», and the evaluator walks
// the course the way the `live/doctor/learning` journey expects.

const rows = buildGoldenLearning(new Date("2026-01-15T12:00:00.000Z"));
const L = golden.learning;
const preset = LEARNING_PRESET_SEEDS.find(
  (p) => p.name === LEARNING_PRESET_NAMES.path,
)!;

const stepModel = (
  row: (typeof rows.learningSteps)[number],
): LearningStepModel => ({
  id: row.id!,
  type: row.type as LearningStepModel["type"],
  title: row.title,
  durationMin: row.durationMin,
  payload: row.payload as Record<string, unknown>,
});

const COURSE: LearningCourseModel = {
  id: L.course.id,
  schoolId: L.school.id,
  modules: [...rows.learningModules]
    .sort((a, b) => a.position - b.position)
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
            .map(stepModel),
        })),
    })),
};

const LAYERS = new LearningLayers([
  {
    scopeKind: "platform",
    scopeId: LEARNING_PLATFORM_SCOPE_ID,
    values: LEARNING_PLATFORM_SEED,
    preset: null,
  },
  {
    scopeKind: "course",
    scopeId: L.course.id,
    values: preset.values,
    preset: preset.name,
    presetValues: preset.values,
  },
]);

/** The admin-written payload of a step, a test's rebuilt from its rows (`storedTestPayload`). */
function storedPayload(stepId: string): unknown {
  const step = rows.learningSteps.find((s) => s.id === stepId)!;
  if (step.type !== "test") return step.payload;
  return {
    kind: (step.payload as Record<string, unknown>)["kind"],
    questions: rows.learningQuestions
      .filter((q) => q.testId === stepId)
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

const run = (facts: LearningFactModel[]) =>
  evaluateCourse({
    course: COURSE,
    layers: LAYERS,
    facts,
    now: new Date("2026-01-16T00:00:00Z"),
  });

describe("#4059 — the golden learning course holds the admin path's rules", () => {
  it("applies the preset the migration seeds under its name", () => {
    expect(GOLDEN_COURSE_PRESET_NAME).toBe(LEARNING_PRESET_NAMES.path);
    expect(rows.learningRuleLayers).toEqual([
      expect.objectContaining({
        scopeKind: "course",
        scopeId: L.course.id,
        presetName: LEARNING_PRESET_NAMES.path,
      }),
    ]);
  });

  it("every step payload passes its element type's schema, as `createStep` validates it", () => {
    for (const step of rows.learningSteps) {
      expect(
        validateStepPayload(step.type, storedPayload(step.id!)),
        step.title,
      ).toMatchObject({ ok: true });
    }
  });

  it("every published lesson meets the EARS-4 publish requirements under the applied preset", () => {
    expect(rows.learningCourses[0]!.state).toBe("published");
    for (const module of COURSE.modules) {
      for (const lesson of module.lessons) {
        const steps = rows.learningSteps.filter(
          (s) => s.lessonId === lesson.id,
        );
        const issues = publishRequirements(
          lesson,
          LAYERS,
          {
            school: L.school.id,
            course: L.course.id,
            module: module.id,
            lesson: lesson.id,
          },
          storedPayload,
          (id) => steps.find((s) => s.id === id)?.mediaRef != null,
          (id) => steps.find((s) => s.id === id)?.embedRef != null,
        );
        expect(issues, lesson.title).toEqual([]);
      }
    }
    expect(rows.learningLessons.every((l) => l.state === "published")).toBe(
      true,
    );
  });

  it("records the download's real size and type", () => {
    const download = rows.learningSteps.find(
      (s) => s.id === L.steps.firstDownload.id,
    )!;
    expect(download.mediaSizeBytes).toBe(goldenCourseMemoPdf().byteLength);
    expect(download.mediaContentType).toBe("application/pdf");
  });

  it("walks as the live journey reads it: lesson 1 open, lesson 2 locked, then lesson 2 current once lesson 1 is done", () => {
    const fresh = run([]).evaluation;
    expect(fresh.current).toEqual({
      stepId: L.steps.firstVideo.id,
      lessonId: L.lessons.first.id,
    });
    expect(fresh.states.get(L.steps.secondVideo.id)).toMatchObject({
      status: "locked",
    });

    const done = run([
      { kind: "position", stepId: L.steps.firstVideo.id, positionSec: 60 },
      { kind: "opened", stepId: L.steps.firstDownload.id },
      {
        kind: "attempt-submitted",
        stepId: L.steps.firstExitTest.id,
        score: 100,
      },
    ]).evaluation;
    expect(done.states.get(L.lessons.first.id)).toEqual({ status: "done" });
    expect(done.current).toEqual({
      stepId: L.steps.secondVideo.id,
      lessonId: L.lessons.second.id,
    });
  });
});
