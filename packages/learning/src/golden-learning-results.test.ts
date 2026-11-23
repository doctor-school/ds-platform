import { describe, expect, it } from "vitest";
import {
  buildGoldenLearningVolume,
  golden,
  GOLDEN_LEARNERS,
  GOLDEN_LEARNING_PATH_COURSES,
  GOLDEN_LEARNING_PATH_PASS_MARK,
  GOLDEN_RULE_CHANGE_COURSE,
  goldenLearningCompletions,
  goldenResultPlans,
} from "@ds/db/seed/golden";
import {
  evaluateCourse,
  LEARNING_PLATFORM_SCOPE_ID,
  LEARNING_PLATFORM_SEED,
  LearningLayers,
  type LearningCourseModel,
  type LearningFactModel,
  type LearningSettingValues,
  type LearningStepModel,
} from "./index.js";

// 024 EARS-24, EARS-29–31 (#4012) — the long paths' submitted results
// (`packages/db/src/seed/golden/learning-results.ts`) are written straight into
// `ds_golden`, so they are held here against the evaluator: the seeded
// `learning_node_status` projection is exactly what `project()` would have
// left for those facts, the ledger credits exactly the completions the
// evaluator marks done, and a raise of the pass mark to 80 % re-judges what
// the owner walks — several lessons of one doctor on the 12-module path, and
// every one of the 200 doctors on the 30-module path.

const rows = buildGoldenLearningVolume(new Date("2026-01-15T12:00:00.000Z"));
const NOW = new Date("2026-06-01T00:00:00Z");

function courseModel(courseId: string): LearningCourseModel {
  const course = rows.learningCourses.find((c) => c.id === courseId)!;
  return {
    id: courseId,
    schoolId: course.schoolId,
    modules: rows.learningModules
      .filter((m) => m.courseId === courseId)
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

function layersOf(
  courseId: string,
  override: LearningSettingValues = {},
): LearningLayers {
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
      values: { ...(own.values as LearningSettingValues), ...override },
      preset: null,
    },
  ]);
}

function factsOf(personId: string, stepIds: Set<string>): LearningFactModel[] {
  return rows.learningFacts
    .filter((f) => f.personId === personId && stepIds.has(f.stepId!))
    .map((f): LearningFactModel => {
      const data = f.data as Record<string, unknown>;
      if (f.kind === "opened") return { kind: "opened", stepId: f.stepId! };
      if (f.kind === "attempt-submitted")
        return {
          kind: "attempt-submitted",
          stepId: f.stepId!,
          score: Number(data["score"]),
        };
      return {
        kind: "position",
        stepId: f.stepId!,
        positionSec: Number(data["positionSec"]),
      };
    });
}

const models = GOLDEN_LEARNING_PATH_COURSES.map((c) => courseModel(c.id));
const stepIdsOf = (model: LearningCourseModel) =>
  new Set(
    model.modules.flatMap((m) => m.lessons.flatMap((l) => l.steps.map((s) => s.id))),
  );

function statuses(
  personId: string,
  course: number,
  override: LearningSettingValues = {},
) {
  const model = models[course]!;
  return evaluateCourse({
    course: model,
    layers: layersOf(model.id, override),
    facts: factsOf(personId, stepIdsOf(model)),
    now: NOW,
  }).evaluation;
}

describe("024 EARS-24, EARS-29–31 (#4012) — the golden long-path results hold the evaluator", () => {
  const plans = goldenResultPlans();

  it("seeds results for the worker pool on the 12-module path and 200 doctors on the 30-module path", () => {
    const pool = golden.workerPool.verifiedCardiologist.length;
    expect(plans.filter((p) => p.course === 0)).toHaveLength(pool);
    expect(plans.filter((p) => p.course === 1)).toHaveLength(
      pool + GOLDEN_LEARNERS,
    );
    expect(pool + GOLDEN_LEARNERS).toBe(200);
  });

  it("the seeded projection is exactly what the projector leaves for the seeded facts", () => {
    for (const plan of plans) {
      const evaluation = statuses(plan.personId, plan.course);
      const model = models[plan.course]!;
      const items = new Set([...evaluation.states.keys()]);
      const seeded = new Map(
        rows.learningNodeStatus
          .filter((r) => r.personId === plan.personId && items.has(r.itemId))
          .map((r) => [r.itemId, r.status]),
      );
      const expected = new Map(
        [...evaluation.states].map(([id, s]) => [id, s.status]),
      );
      expect(seeded, `${plan.personId} ${model.id}`).toEqual(expected);
    }
  }, 60_000);

  it("every seeded score passes the 50 % pass mark, so each planned lesson is done", () => {
    for (const plan of plans) {
      const evaluation = statuses(plan.personId, plan.course);
      const lessons = models[plan.course]!.modules.flatMap((m) => m.lessons);
      const done = lessons.filter(
        (l) => evaluation.states.get(l.id)?.status === "done",
      );
      expect(done.map((l) => l.id)).toEqual(
        lessons.slice(0, plan.scores.length).map((l) => l.id),
      );
    }
    expect(GOLDEN_LEARNING_PATH_PASS_MARK).toBe(50);
  });

  it("the ledger credits exactly the lessons and modules the evaluator marks done", () => {
    const persons = [...new Set(plans.map((p) => p.personId))];
    const pathItems = new Set(
      models.flatMap((m) => [
        ...m.modules.map((x) => x.id),
        ...m.modules.flatMap((x) => x.lessons.map((l) => l.id)),
      ]),
    );
    const credited = goldenLearningCompletions(
      {
        ...rows,
        learningRuleLayers: rows.learningOwnRuleLayers,
      },
      persons,
    )
      .filter((c) => pathItems.has(c.id))
      .map((c) => `${c.personId}|${c.id}`)
      .sort();
    const done: string[] = [];
    for (const plan of plans) {
      const evaluation = statuses(plan.personId, plan.course);
      for (const [id, state] of evaluation.states) {
        const kind = evaluation.kinds.get(id);
        if (state.status === "done" && (kind === "lesson" || kind === "module"))
          done.push(`${plan.personId}|${id}`);
      }
    }
    expect(credited.length).toBeGreaterThan(0);
    expect(credited).toEqual(done.sort());
  }, 60_000);

  it("a raise to 80 % reopens three lessons of the golden doctor on the 12-module path", () => {
    const doctor = golden.doctors.verifiedCardiologist.id;
    const lessons = models[0]!.modules.flatMap((m) => m.lessons);
    const before = statuses(doctor, 0);
    const after = statuses(doctor, 0, { "test.threshold": 80 });
    const reopened = lessons.filter(
      (l) =>
        before.states.get(l.id)?.status === "done" &&
        after.states.get(l.id)?.status !== "done",
    );
    expect(reopened).toHaveLength(3);
  });

  it("a raise to 80 % changes a status of every one of the 200 doctors on the 30-module path", () => {
    const changed = plans
      .filter((p) => p.course === 1)
      .filter((p) => {
        const before = statuses(p.personId, 1);
        const after = statuses(p.personId, 1, { "test.threshold": 80 });
        return [...before.states].some(
          ([id, s]) => after.states.get(id)?.status !== s.status,
        );
      });
    expect(changed).toHaveLength(200);
  }, 60_000);

  it("the seeded past rule change moved no status: every doctor on its course evaluates the same under its before and after values", () => {
    const [change] = rows.learningRuleChanges;
    const model = models[GOLDEN_RULE_CHANGE_COURSE]!;
    expect(change!.scopeId).toBe(model.id);
    const before = change!.before as LearningSettingValues;
    const after = change!.after as LearningSettingValues;
    const holders = plans.filter((p) => p.course === GOLDEN_RULE_CHANGE_COURSE);
    expect(holders).toHaveLength(200);
    for (const p of holders) {
      const under = (values: LearningSettingValues) =>
        new Map(
          [...statuses(p.personId, GOLDEN_RULE_CHANGE_COURSE, values).states].map(
            ([id, s]) => [id, s.status],
          ),
        );
      expect(under(before), p.personId).toEqual(under(after));
    }
  }, 60_000);
});
