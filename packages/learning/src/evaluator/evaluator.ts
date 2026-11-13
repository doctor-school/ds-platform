import type {
  LearningLockReason,
  LearningNodeState,
  LearningRuleNode,
  LearningSettingKey,
  LearningSettings,
} from "@ds/schemas";
import { conditionType } from "../catalog/condition-types.js";
import { LEARNING_COPY_RU } from "../copy/learning-copy-ru.js";
import type { LearningCourseModel, LearningFactModel, LearningStepModel } from "../model.js";
import type { LearningLayers } from "../rules/resolver.js";
import {
  LearningCourseIndex,
  type LearningEvalContext,
  LearningFactIndex,
  type LearningItemKind,
  type LearningItemRef,
} from "./context.js";

// 024 EARS-6, EARS-7, EARS-11, EARS-17 — the ONE evaluator. Every step, lesson,
// module and course status of a doctor is computed here from the doctor's facts
// and the rules resolved now; nothing is stored as the truth (024-design §4).
// Order: facts → step done by its completion tree → lesson → module → course;
// then unlock per item in path order with `order` and `unlock`; `current` = the
// first open, not done step.

export interface LearningEvaluationInput {
  course: LearningCourseModel;
  layers: LearningLayers;
  facts: Iterable<LearningFactModel>;
  now: Date;
}

export interface LearningEvaluation {
  /** Every item's state by id (step, lesson, module and course ids are distinct uuids). */
  states: Map<string, LearningNodeState>;
  /** The kind of every evaluated item, by id. */
  kinds: Map<string, LearningItemKind>;
  current: { stepId: string; lessonId: string } | null;
  /** The club node of each module WHILE `course.closingClub` is on. */
  clubs: Map<string, LearningNodeState>;
  document: LearningNodeState;
}

function isStep(at: LearningStepModel | LearningItemRef): at is LearningStepModel {
  return "type" in at;
}

export class LearningCourseEvaluator implements LearningEvalContext {
  readonly index: LearningCourseIndex;
  readonly facts: LearningFactIndex;
  readonly layers: LearningLayers;
  private readonly now: Date;
  private readonly doneMemo = new Map<string, boolean>();
  private readonly inProgress = new Set<string>();

  constructor(input: LearningEvaluationInput) {
    this.index = new LearningCourseIndex(input.course);
    this.facts = new LearningFactIndex(input.facts);
    this.layers = input.layers;
    this.now = input.now;
  }

  setting<K extends LearningSettingKey>(key: K, at: LearningStepModel | LearningItemRef): LearningSettings[K] {
    const ref: LearningItemRef = isStep(at) ? { kind: "step", id: at.id } : at;
    return this.layers.value(key, this.index.pathOf(ref));
  }

  /** EARS-5 — the full resolution of a setting at an item. */
  resolve<K extends LearningSettingKey>(key: K, ref: LearningItemRef) {
    return this.layers.resolve(key, this.index.pathOf(ref));
  }

  /** EARS-6 — whether an item's completion tree is satisfied. */
  done(ref: LearningItemRef): boolean {
    const memo = this.doneMemo.get(ref.id);
    if (memo !== undefined) return memo;
    if (this.inProgress.has(ref.id)) return false;
    this.inProgress.add(ref.id);
    const result =
      this.facts.keptDone(ref.id) ||
      this.evalTree(this.setting(`completion.${ref.kind}`, ref), ref);
    this.inProgress.delete(ref.id);
    this.doneMemo.set(ref.id, result);
    return result;
  }

  /** Evaluate a rule tree at a scope; a gated-off condition counts as met. */
  evalTree(node: LearningRuleNode, scope: LearningItemRef): boolean {
    if ("all" in node) return node.all.every((c) => this.evalTree(c, scope));
    if ("any" in node) return node.any.some((c) => this.evalTree(c, scope));
    if ("nOf" in node) {
      return node.nOf.of.filter((c) => this.evalTree(c, scope)).length >= node.nOf.n;
    }
    const def = conditionType(node.condition);
    if (!def) return false;
    const verdict = def.evaluate(node, scope, this);
    return verdict === "off" ? true : verdict;
  }

  /** EARS-17 — the completion sentence of an item from its resolved rule. */
  sentence(ref: LearningItemRef): string {
    const clause = this.clause(this.setting(`completion.${ref.kind}`, ref), ref);
    return `${LEARNING_COPY_RU.sentencePrefix[ref.kind]} ${clause ?? LEARNING_COPY_RU.phrase.always}`;
  }

  private clause(node: LearningRuleNode, scope: LearningItemRef): string | null {
    if ("all" in node || "any" in node) {
      const children = ("all" in node ? node.all : node.any)
        .map((c) => this.clause(c, scope))
        .filter((c): c is string => c !== null);
      if (children.length === 0) return null;
      return joinClauses(children, "all" in node ? LEARNING_COPY_RU.and : LEARNING_COPY_RU.or);
    }
    if ("nOf" in node) {
      const children = node.nOf.of
        .map((c) => this.clause(c, scope))
        .filter((c): c is string => c !== null);
      if (children.length === 0) return null;
      return LEARNING_COPY_RU.phrase.nOf(node.nOf.n, children.join("; "));
    }
    return conditionType(node.condition)?.phrase(node, scope, this) ?? null;
  }

  /** EARS-7 — the unmet unlock of an item, or null when it is unlocked. */
  private lockOf(
    ref: LearningItemRef,
    previousDone: boolean | undefined,
    containerLock: LearningLockReason | null,
  ): LearningLockReason | null {
    if (containerLock) return containerLock;
    const unlock = this.setting("unlock", ref);
    switch (unlock.kind) {
      case "immediate":
        return null;
      case "after-previous": {
        if (ref.kind === "step" || ref.kind === "lesson") {
          const moduleId = this.index.pathOf(ref).module;
          if (moduleId && this.setting("order", { kind: "module", id: moduleId }) === "free") {
            return null;
          }
        }
        if (ref.kind === "module" && this.setting("order", { kind: "course", id: this.index.course.id }) === "free") {
          return null;
        }
        return previousDone === undefined || previousDone ? null : { kind: "previous" };
      }
      case "from-date":
        return this.now.getTime() >= Date.parse(unlock.instant)
          ? null
          : { kind: "date", at: new Date(unlock.instant).toISOString() };
      case "expression":
        return this.evalTree(unlock.rule, { kind: "course", id: this.index.course.id })
          ? null
          : { kind: "expression" };
    }
  }

  /** EARS-11 — every status of the course for this doctor. */
  evaluate(): LearningEvaluation {
    const states = new Map<string, LearningNodeState>();
    const kinds = new Map<string, LearningItemKind>();
    const clubs = new Map<string, LearningNodeState>();
    const locks = new Map<string, LearningLockReason | null>();
    const course = this.index.course;

    let previousModuleDone: boolean | undefined;
    for (const module of course.modules) {
      const mRef: LearningItemRef = { kind: "module", id: module.id };
      const mLock = this.lockOf(mRef, previousModuleDone, null);
      locks.set(module.id, mLock);
      let previousLessonDone: boolean | undefined;
      for (const lesson of module.lessons) {
        const lRef: LearningItemRef = { kind: "lesson", id: lesson.id };
        const lLock = this.lockOf(lRef, previousLessonDone, mLock);
        locks.set(lesson.id, lLock);
        let previousStepDone: boolean | undefined;
        for (const step of lesson.steps) {
          const sRef: LearningItemRef = { kind: "step", id: step.id };
          locks.set(step.id, this.lockOf(sRef, previousStepDone, lLock));
          previousStepDone = this.done(sRef);
        }
        previousLessonDone = this.done(lRef);
      }
      previousModuleDone = this.done(mRef);
    }

    const stateOf = (ref: LearningItemRef): LearningNodeState => {
      kinds.set(ref.id, ref.kind);
      if (this.done(ref)) return { status: "done" };
      const lock = locks.get(ref.id) ?? null;
      return lock ? { status: "locked", reason: lock } : { status: "open" };
    };

    let current: LearningEvaluation["current"] = null;
    let currentModule: string | null = null;
    for (const module of course.modules) {
      states.set(module.id, stateOf({ kind: "module", id: module.id }));
      for (const lesson of module.lessons) {
        states.set(lesson.id, stateOf({ kind: "lesson", id: lesson.id }));
        for (const step of lesson.steps) {
          const state = stateOf({ kind: "step", id: step.id });
          if (current === null && state.status === "open") {
            current = { stepId: step.id, lessonId: lesson.id };
            currentModule = module.id;
            states.set(step.id, { status: "current" });
          } else {
            states.set(step.id, state);
          }
        }
      }
      if (this.setting("course.closingClub", { kind: "module", id: module.id })) {
        const lessonsDone = module.lessons.every((l) => this.done({ kind: "lesson", id: l.id }));
        clubs.set(
          module.id,
          this.facts.clubAttended(module.id)
            ? { status: "done" }
            : lessonsDone
              ? { status: "open" }
              : { status: "locked", reason: { kind: "previous" } },
        );
      }
    }
    const courseState = stateOf({ kind: "course", id: course.id });
    states.set(course.id, courseState);

    if (current !== null) {
      const { lessonId } = current;
      for (const id of [lessonId, currentModule, course.id]) {
        if (id !== null && states.get(id)?.status === "open") states.set(id, { status: "current" });
      }
    }

    return {
      states,
      kinds,
      current,
      clubs,
      document: courseState.status === "done" ? { status: "done" } : { status: "locked", reason: { kind: "previous" } },
    };
  }
}

function joinClauses(parts: string[], last: string): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")}${last}${parts[parts.length - 1]}`;
}

/** Evaluate a course for one doctor (EARS-11). */
export function evaluateCourse(input: LearningEvaluationInput): {
  evaluator: LearningCourseEvaluator;
  evaluation: LearningEvaluation;
} {
  const evaluator = new LearningCourseEvaluator(input);
  return { evaluator, evaluation: evaluator.evaluate() };
}
