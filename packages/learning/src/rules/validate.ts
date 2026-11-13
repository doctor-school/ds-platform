import {
  LEARNING_RULE_MAX_DEPTH,
  LEARNING_SETTING_KEYS,
  LEARNING_SETTING_SCHEMAS,
  type LearningRuleNode,
  type LearningScopeKind,
  type LearningSettingKey,
  type LearningSettingValues,
} from "@ds/schemas";
import { conditionType } from "../catalog/condition-types.js";
import { elementType, isExitTest } from "../catalog/element-types.js";
import type { LearningItemKind } from "../evaluator/context.js";
import type { LearningLessonModel } from "../model.js";
import type { LearningLayers } from "./resolver.js";

// 024 EARS-2, EARS-3, EARS-4, EARS-6 — write-time validation. A refused rule or
// step changes nothing; every problem is a field error naming its path.

export interface LearningFieldIssue {
  path: string;
  message: string;
}

/** The items a rule written on a layer may reference (EARS-6: «inside the rule's scope»). */
export interface LearningRuleScope {
  stepIds: ReadonlySet<string>;
  moduleIds: ReadonlySet<string>;
  /** Test step ids among `stepIds`. */
  testStepIds: ReadonlySet<string>;
}

export const EMPTY_RULE_SCOPE: LearningRuleScope = {
  stepIds: new Set(),
  moduleIds: new Set(),
  testStepIds: new Set(),
};

/** EARS-3, EARS-6 — a completion-rule tree: known conditions, references in scope, `n` and depth bounds. */
export function validateRuleTree(
  node: LearningRuleNode,
  target: LearningItemKind,
  scope: LearningRuleScope,
  path = "",
  depth = 1,
): LearningFieldIssue[] {
  const issues: LearningFieldIssue[] = [];
  const at = (suffix: string) => (path ? `${path}.${suffix}` : suffix);
  if (depth > LEARNING_RULE_MAX_DEPTH) {
    return [{ path: path || "rule", message: `a rule tree is at most ${LEARNING_RULE_MAX_DEPTH} deep` }];
  }
  if ("all" in node || "any" in node) {
    const key = "all" in node ? "all" : "any";
    const children = "all" in node ? node.all : node.any;
    children.forEach((c, i) => issues.push(...validateRuleTree(c, target, scope, at(`${key}.${i}`), depth + 1)));
    return issues;
  }
  if ("nOf" in node) {
    const { n, of } = node.nOf;
    if (n < 1 || n > of.length) {
      issues.push({ path: at("nOf.n"), message: `n is between 1 and ${of.length}` });
    }
    of.forEach((c, i) => issues.push(...validateRuleTree(c, target, scope, at(`nOf.of.${i}`), depth + 1)));
    return issues;
  }
  const def = conditionType(node.condition);
  if (!def) {
    return [{ path: at("condition"), message: `unknown condition type «${node.condition}»` }];
  }
  if (def.needsPercent && node.percent === undefined) {
    issues.push({ path: at("percent"), message: "a percent is required" });
  }
  if (node.step !== undefined && !scope.stepIds.has(node.step)) {
    issues.push({ path: at("step"), message: "the step is not inside the rule's scope" });
  }
  if (node.module !== undefined && !scope.moduleIds.has(node.module)) {
    issues.push({ path: at("module"), message: "the module is not inside the rule's scope" });
  }
  if (node.test !== undefined && node.test !== "exit" && node.test !== "entry" && !scope.testStepIds.has(node.test)) {
    issues.push({ path: at("test"), message: "the test is not inside the rule's scope" });
  }
  const explicit =
    (def.ref === "step" && node.step !== undefined) ||
    (def.ref === "module" && node.module !== undefined) ||
    (def.type === "test-passed" && node.test !== undefined && node.test !== "exit" && node.test !== "entry");
  if (!def.targets.includes(target) && !explicit) {
    issues.push({
      path: at("condition"),
      message: `«${node.condition}» does not complete a ${target}${def.ref ? ` without a ${def.ref}` : ""}`,
    });
  }
  return issues;
}

/** Which layers may hold a key (024-design §3 «Levels»). */
const KEY_LEVELS: Partial<Record<LearningSettingKey, readonly LearningScopeKind[]>> = {
  "course.deliveryMode": ["platform", "school", "course"],
  "course.moduleSize": ["platform", "school", "course"],
  "course.closingClub": ["platform", "school", "course"],
  "course.clubInCompletion": ["platform", "school", "course"],
  order: ["platform", "school", "course", "module"],
};

export type LearningValuesValidation =
  | { ok: true; values: LearningSettingValues }
  | { ok: false; issues: LearningFieldIssue[] };

/** EARS-5…EARS-8 — a layer's or a preset's partial values. */
export function validateSettingValues(
  raw: unknown,
  level: LearningScopeKind,
  scope: LearningRuleScope,
): LearningValuesValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "values", message: "an object of settings" }] };
  }
  const issues: LearningFieldIssue[] = [];
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(LEARNING_SETTING_KEYS as string[]).includes(key)) {
      issues.push({ path: `values.${key}`, message: "unknown setting" });
      continue;
    }
    const k = key as LearningSettingKey;
    const levels = KEY_LEVELS[k];
    if (levels && !levels.includes(level)) {
      issues.push({ path: `values.${key}`, message: `not a setting of the ${level} level` });
      continue;
    }
    const parsed = LEARNING_SETTING_SCHEMAS[k].safeParse(value);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({ path: ["values", key, ...i.path.map(String)].join("."), message: i.message });
      }
      continue;
    }
    if (k.startsWith("completion.")) {
      const target = k.slice("completion.".length) as LearningItemKind;
      issues.push(...validateRuleTree(parsed.data as LearningRuleNode, target, scope, `values.${key}`));
    }
    if (k === "unlock") {
      const unlock = parsed.data as LearningSettingValues["unlock"];
      if (unlock?.kind === "expression") {
        issues.push(...validateRuleTree(unlock.rule, "course", scope, `values.unlock.rule`));
      }
    }
    values[key] = parsed.data;
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, values: values as LearningSettingValues };
}

/** EARS-2 — a step's type and payload; an unknown type is a `type` field error. */
export function validateStepPayload(
  type: string,
  payload: unknown,
): { ok: true; payload: Record<string, unknown> } | { ok: false; issues: LearningFieldIssue[] } {
  const def = elementType(type);
  if (!def) return { ok: false, issues: [{ path: "type", message: `unknown element type «${type}»` }] };
  const parsed = def.payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: ["payload", ...i.path.map(String)].join("."), message: i.message })),
    };
  }
  return { ok: true, payload: parsed.data as Record<string, unknown> };
}

/**
 * EARS-4 — what a lesson still misses before it may be published: at least one
 * step, every step's required payload, and — where the resolved rules require
 * one — the exit test and the entry test.
 */
export function publishRequirements(
  lesson: LearningLessonModel,
  layers: LearningLayers,
  path: Parameters<LearningLayers["resolve"]>[1],
  /** The step's stored payload as an admin wrote it (a test's questions included). */
  storedPayloadOf: (stepId: string) => unknown,
): LearningFieldIssue[] {
  const issues: LearningFieldIssue[] = [];
  if (lesson.steps.length === 0) issues.push({ path: "steps", message: "a lesson has at least one step" });
  lesson.steps.forEach((step, i) => {
    const check = validateStepPayload(step.type, storedPayloadOf(step.id));
    if (!check.ok) {
      for (const issue of check.issues) issues.push({ path: `steps.${i}.${issue.path}`, message: issue.message });
    }
  });
  if (layers.value("test.exitRequired", path) && !lesson.steps.some(isExitTest)) {
    issues.push({ path: "exitTest", message: "the rules require an exit test" });
  }
  if (layers.value("test.entryRequired", path)) {
    // The entry test step lands with #4014; until then a lesson whose rules
    // require one cannot be whole.
    issues.push({ path: "entryTest", message: "the rules require an entry test" });
  }
  return issues;
}
