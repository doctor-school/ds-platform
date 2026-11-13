import type { LearningConditionNode, LearningConditionType } from "@ds/schemas";
import { LEARNING_CONDITION_TYPES } from "@ds/schemas";
import { LEARNING_COPY_RU } from "../copy/learning-copy-ru.js";
import type {
  LearningEvalContext,
  LearningItemKind,
  LearningItemRef,
} from "../evaluator/context.js";
import { elementType, isExitTest, watchedPercent } from "./element-types.js";

// 024 EARS-3 — the condition-type catalog as code. Adding a condition type is a
// code change here; a combination or a number is data (a rule tree, a setting).
//
// Two conditions are GATED by settings (EARS-6): `test-passed { test: exit }`
// counts only WHILE `test.exitRequired` resolves on, `club-attended` only WHILE
// `course.closingClub` and `course.clubInCompletion` both resolve on. A gated
// condition is satisfied and says nothing in the sentence (EARS-17).

/** The verdict of one condition: `off` = gated off by its setting. */
export type LearningConditionVerdict = boolean | "off";

export interface LearningConditionDef {
  type: LearningConditionType;
  /** The item kinds a rule of this condition may complete without explicit references. */
  targets: readonly LearningItemKind[];
  /** The reference parameter it reads, if any, and whether it is required at every target. */
  ref?: "step" | "module";
  /** `percent` is required. */
  needsPercent?: boolean;
  evaluate(node: LearningConditionNode, scope: LearningItemRef, ctx: LearningEvalContext): LearningConditionVerdict;
  /** The clause, or null when gated off (EARS-17). */
  phrase(node: LearningConditionNode, scope: LearningItemRef, ctx: LearningEvalContext): string | null;
}

function stepOf(node: LearningConditionNode, scope: LearningItemRef, ctx: LearningEvalContext) {
  const id = node.step ?? (scope.kind === "step" ? scope.id : undefined);
  return id === undefined ? undefined : ctx.index.steps.get(id)?.step;
}

function withStepTitle(node: LearningConditionNode, scope: LearningItemRef, title: string, clause: string): string {
  return node.step !== undefined && !(scope.kind === "step" && scope.id === node.step)
    ? LEARNING_COPY_RU.phrase.stepViewed(title, clause)
    : clause;
}

/** The lesson a `test-passed { test: exit }` reads: the scope lesson or the scope step's lesson. */
function lessonOf(scope: LearningItemRef, ctx: LearningEvalContext) {
  if (scope.kind === "lesson") return ctx.index.lessons.get(scope.id)?.lesson;
  if (scope.kind === "step") return ctx.index.steps.get(scope.id)?.lesson;
  return undefined;
}

function testStepOf(node: LearningConditionNode, scope: LearningItemRef, ctx: LearningEvalContext) {
  if (node.test === undefined || node.test === "exit") {
    return lessonOf(scope, ctx)?.steps.find(isExitTest);
  }
  return ctx.index.steps.get(node.test)?.step;
}

function clubGatedOff(scope: LearningItemRef, ctx: LearningEvalContext): boolean {
  return !(ctx.setting("course.closingClub", scope) && ctx.setting("course.clubInCompletion", scope));
}

export const LEARNING_CONDITION_CATALOG: Readonly<Record<LearningConditionType, LearningConditionDef>> = {
  viewed: {
    type: "viewed",
    targets: ["step"],
    ref: "step",
    evaluate: (node, scope, ctx) => {
      const step = stepOf(node, scope, ctx);
      return step ? (elementType(step.type)?.viewed(step, ctx) ?? false) : false;
    },
    phrase: (node, scope, ctx) => {
      const step = stepOf(node, scope, ctx);
      if (!step) return null;
      const clause = elementType(step.type)!.viewedPhrase(step, ctx);
      return withStepTitle(node, scope, step.title, clause);
    },
  },
  "watched-at-least": {
    type: "watched-at-least",
    targets: ["step"],
    ref: "step",
    needsPercent: true,
    evaluate: (node, scope, ctx) => {
      const step = stepOf(node, scope, ctx);
      return step?.type === "video" ? watchedPercent(step, ctx) >= (node.percent ?? 100) : false;
    },
    phrase: (node, scope, ctx) => {
      const step = stepOf(node, scope, ctx);
      const clause = LEARNING_COPY_RU.phrase.videoWatchedAtLeast(node.percent ?? 100);
      return step ? withStepTitle(node, scope, step.title, clause) : clause;
    },
  },
  opened: {
    type: "opened",
    targets: ["step"],
    ref: "step",
    evaluate: (node, scope, ctx) => {
      const step = stepOf(node, scope, ctx);
      return step ? ctx.facts.opened(step.id) : false;
    },
    phrase: (node, scope, ctx) => {
      const step = stepOf(node, scope, ctx);
      const clause = LEARNING_COPY_RU.phrase.downloadOpened;
      return step ? withStepTitle(node, scope, step.title, clause) : clause;
    },
  },
  "listened-at-least": {
    type: "listened-at-least",
    targets: ["step"],
    ref: "step",
    needsPercent: true,
    // No `podcast` type is declared in this slice (#4013); a podcast-less
    // condition is never met.
    evaluate: () => false,
    phrase: (node) => LEARNING_COPY_RU.phrase.podcastListenedAtLeast(node.percent ?? 100),
  },
  "test-passed": {
    type: "test-passed",
    targets: ["step", "lesson"],
    evaluate: (node, scope, ctx) => {
      if (node.test === "entry") return "off"; // the entry test lands with #4014
      if ((node.test === undefined || node.test === "exit") && !ctx.setting("test.exitRequired", scope)) {
        return "off";
      }
      const step = testStepOf(node, scope, ctx);
      return step ? ctx.facts.bestScore(step.id) >= ctx.setting("test.threshold", step) : false;
    },
    phrase: (node, scope, ctx) => {
      if (node.test === "entry") return null;
      if ((node.test === undefined || node.test === "exit") && !ctx.setting("test.exitRequired", scope)) {
        return null;
      }
      const step = testStepOf(node, scope, ctx);
      const threshold = ctx.setting("test.threshold", step ?? scope);
      return LEARNING_COPY_RU.phrase.testPassed(threshold);
    },
  },
  "club-attended": {
    type: "club-attended",
    targets: ["module"],
    ref: "module",
    evaluate: (node, scope, ctx) => {
      if (clubGatedOff(scope, ctx)) return "off";
      const moduleId = node.module ?? (scope.kind === "module" ? scope.id : undefined);
      return moduleId !== undefined && ctx.facts.clubAttended(moduleId);
    },
    phrase: (_node, scope, ctx) => (clubGatedOff(scope, ctx) ? null : LEARNING_COPY_RU.phrase.clubAttended),
  },
  "manual-mark": {
    type: "manual-mark",
    targets: ["step", "lesson", "module", "course"],
    evaluate: (_node, scope, ctx) => ctx.facts.marked(scope.id),
    phrase: () => LEARNING_COPY_RU.phrase.manualMark,
  },
  "all-steps-done": {
    type: "all-steps-done",
    targets: ["lesson", "module", "course"],
    evaluate: (_node, scope, ctx) => {
      const ids = ctx.index.stepIdsOf(scope);
      return ids.length > 0 && ids.every((id) => ctx.done({ kind: "step", id }));
    },
    phrase: () => LEARNING_COPY_RU.phrase.allStepsDone,
  },
  // At a module: every lesson done. At the course: every module done — a
  // module's own completion carries its lessons (EARS-6 «a course's every
  // module done»).
  "lessons-done": {
    type: "lessons-done",
    targets: ["module", "course"],
    evaluate: (_node, scope, ctx) => {
      if (scope.kind === "course") {
        const modules = ctx.index.course.modules;
        return modules.length > 0 && modules.every((m) => ctx.done({ kind: "module", id: m.id }));
      }
      if (scope.kind !== "module") return false;
      const lessons = ctx.index.modules.get(scope.id)?.lessons ?? [];
      return lessons.length > 0 && lessons.every((l) => ctx.done({ kind: "lesson", id: l.id }));
    },
    phrase: (_node, scope) =>
      scope.kind === "course" ? LEARNING_COPY_RU.phrase.modulesDone : LEARNING_COPY_RU.phrase.lessonsDone,
  },
};

/** EARS-3 — the catalog entry, or undefined for a condition it does not declare. */
export function conditionType(name: string): LearningConditionDef | undefined {
  return (LEARNING_CONDITION_TYPES as readonly string[]).includes(name)
    ? LEARNING_CONDITION_CATALOG[name as LearningConditionType]
    : undefined;
}
