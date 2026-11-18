import type {
  LearningCourseModel,
  LearningFactModel,
  LearningLessonModel,
  LearningModuleModel,
  LearningScopePath,
  LearningSettingKey,
  LearningSettings,
  LearningStepModel,
} from "../model.js";
import type { LearningLayers } from "../rules/resolver.js";

// 024 — what a condition or an element type reads while the evaluator runs:
// the doctor's facts (indexed), the course tree and the resolved settings.

export type LearningItemKind = "step" | "lesson" | "module" | "course";

export interface LearningItemRef {
  kind: LearningItemKind;
  id: string;
}

/** The doctor's facts, indexed for the evaluator. */
export class LearningFactIndex {
  private readonly positions = new Map<string, number>();
  private readonly openedSteps = new Set<string>();
  private readonly scores = new Map<string, number>();
  private readonly marks = new Set<string>();
  private readonly clubs = new Set<string>();
  private readonly kept = new Set<string>();

  constructor(facts: Iterable<LearningFactModel>) {
    for (const f of facts) {
      switch (f.kind) {
        case "position":
          this.positions.set(f.stepId, Math.max(this.positions.get(f.stepId) ?? 0, f.positionSec));
          break;
        case "opened":
          this.openedSteps.add(f.stepId);
          break;
        case "attempt-submitted":
          this.scores.set(f.stepId, Math.max(this.scores.get(f.stepId) ?? -1, f.score));
          break;
        case "manual-mark":
          this.marks.add(f.itemId);
          break;
        case "club-attended":
          this.clubs.add(f.moduleId);
          break;
        case "completion-kept":
        case "test-out-passed":
          this.kept.add(f.itemId);
          break;
      }
    }
  }

  maxPosition(stepId: string): number {
    return this.positions.get(stepId) ?? 0;
  }
  opened(stepId: string): boolean {
    return this.openedSteps.has(stepId);
  }
  /** The best submitted score, −1 when none. */
  bestScore(stepId: string): number {
    return this.scores.get(stepId) ?? -1;
  }
  attempted(stepId: string): boolean {
    return this.scores.has(stepId);
  }
  marked(itemId: string): boolean {
    return this.marks.has(itemId);
  }
  clubAttended(moduleId: string): boolean {
    return this.clubs.has(moduleId);
  }
  /** A `completion-kept` or `test-out-passed` fact satisfies the item directly (024-design §4). */
  keptDone(itemId: string): boolean {
    return this.kept.has(itemId);
  }
}

/** Where every item of a course sits, for path building and lookups. */
export class LearningCourseIndex {
  readonly steps = new Map<string, { step: LearningStepModel; lesson: LearningLessonModel; module: LearningModuleModel }>();
  readonly lessons = new Map<string, { lesson: LearningLessonModel; module: LearningModuleModel }>();
  readonly modules = new Map<string, LearningModuleModel>();

  constructor(readonly course: LearningCourseModel) {
    for (const module of course.modules) {
      this.modules.set(module.id, module);
      for (const lesson of module.lessons) {
        this.lessons.set(lesson.id, { lesson, module });
        for (const step of lesson.steps) this.steps.set(step.id, { step, lesson, module });
      }
    }
  }

  /** The resolution path of an item (EARS-5). */
  pathOf(ref: LearningItemRef): LearningScopePath {
    const base: LearningScopePath = { school: this.course.schoolId, course: this.course.id };
    switch (ref.kind) {
      case "course":
        return base;
      case "module":
        return { ...base, module: ref.id };
      case "lesson": {
        const at = this.lessons.get(ref.id);
        return { ...base, module: at?.module.id, lesson: ref.id } as LearningScopePath;
      }
      case "step": {
        const at = this.steps.get(ref.id);
        return {
          ...base,
          module: at?.module.id,
          lesson: at?.lesson.id,
          step: ref.id,
        } as LearningScopePath;
      }
    }
  }

  /** Every step id inside an item. */
  stepIdsOf(ref: LearningItemRef): string[] {
    switch (ref.kind) {
      case "step":
        return [ref.id];
      case "lesson":
        return this.lessons.get(ref.id)?.lesson.steps.map((s) => s.id) ?? [];
      case "module":
        return (this.modules.get(ref.id)?.lessons ?? []).flatMap((l) => l.steps.map((s) => s.id));
      case "course":
        return [...this.steps.keys()];
    }
  }
}

export interface LearningEvalContext {
  readonly index: LearningCourseIndex;
  readonly facts: LearningFactIndex;
  readonly layers: LearningLayers;
  /** A resolved setting value at a step (or any item). */
  setting<K extends LearningSettingKey>(
    key: K,
    at: LearningStepModel | LearningItemRef,
  ): LearningSettings[K];
  /** Whether an item is done (memoised by the evaluator). */
  done(ref: LearningItemRef): boolean;
}
