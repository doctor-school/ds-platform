import {
  getPointsFactType,
  isPointsPredicate,
  POINTS_PREDICATES,
  type PointsRule,
  type PointsRuleLimit,
} from "@ds/schemas";
import {
  checkConditionBounds,
  typecheckConditionForTriggers,
} from "./condition.js";

// 025 amended EARS-25 — the catalog checks of a `kind: "rule"` body that the
// shape (`PointsRuleSchema`) cannot express, in the order of 025-design B:
// condition (bounds, then the type check against every trigger type) →
// effect legality → limit scope fields → `setting.effect.maxAmount`. Every
// issue names its field path relative to the body, e.g.
// `condition.all.0.eq.0`, so the 422 problem points at the offending node.
//
// The spend effects (EARS-35) read the hold of the fact's `registrationId` on
// its item ref and the price list of its ref: a `reserve`, `settle` or
// `release` needs every trigger type to carry an item ref and the
// `registrationId` attribute, a `debit` of the price-list amount an item
// ref; `concurrentOpen` (EARS-21) bounds holds, so only a `reserve` names it.

export interface PublishIssue {
  readonly path: string;
  readonly message: string;
}

function join(path: readonly (string | number)[]): string {
  return path.join(".");
}

/** The limit's scope, or undefined for a limit without one. */
function scopeOf(limit: PointsRuleLimit): readonly string[] | undefined {
  if ("oncePer" in limit) return limit.oncePer;
  if ("countPer" in limit) return limit.countPer.scope;
  return undefined;
}

export function checkRuleBody(
  rule: PointsRule,
  opts: { maxAmount: number },
): PublishIssue[] {
  const issues: PublishIssue[] = [];

  if (rule.condition !== undefined) {
    const bounds = checkConditionBounds(rule.condition);
    const typed =
      bounds.length > 0
        ? bounds
        : typecheckConditionForTriggers(rule.condition, rule.trigger);
    for (const issue of typed) {
      issues.push({
        path: join(["condition", ...issue.path]),
        message: issue.message,
      });
    }
  }

  const effect = rule.effect;
  switch (effect.kind) {
    case "credit": {
      if (typeof effect.beneficiary === "object") {
        const name = effect.beneficiary.pred;
        const decl = isPointsPredicate(name)
          ? POINTS_PREDICATES[name]
          : undefined;
        if (!decl) {
          issues.push({
            path: "effect.beneficiary.pred",
            message: `unknown predicate ${name}`,
          });
        } else if (decl.subject !== "person" || decl.result.type !== "string") {
          issues.push({
            path: "effect.beneficiary.pred",
            message: `${name} does not name a person`,
          });
        }
      }
      if (effect.amounts.pul > 0) {
        for (const type of rule.trigger) {
          if (getPointsFactType(type)?.earnsPul === false) {
            issues.push({
              path: "effect.amounts.pul",
              message: `${type} may not credit Pul`,
            });
          }
        }
      }
      for (const denomination of ["pul", "bre", "con"] as const) {
        if (effect.amounts[denomination] > opts.maxAmount) {
          issues.push({
            path: `effect.amounts.${denomination}`,
            message: `exceeds setting.effect.maxAmount (${opts.maxAmount})`,
          });
        }
      }
      break;
    }
    case "debit":
      if (effect.amounts === "price") {
        for (const type of rule.trigger) {
          if (getPointsFactType(type)?.refKind !== "item") {
            issues.push({
              path: "effect.amounts",
              message: `${type} names no item, so it has no price`,
            });
          }
        }
      } else if (effect.amounts.pul > opts.maxAmount) {
        issues.push({
          path: "effect.amounts.pul",
          message: `exceeds setting.effect.maxAmount (${opts.maxAmount})`,
        });
      }
      break;
    case "reserve":
    case "settle":
    case "release":
      for (const type of rule.trigger) {
        const entry = getPointsFactType(type);
        if (
          entry &&
          (entry.refKind !== "item" ||
            !Object.hasOwn(entry.attributes, "registrationId"))
        ) {
          issues.push({
            path: "effect.kind",
            message: `a ${effect.kind} needs an item ref and a registrationId; ${type} lacks them`,
          });
        }
      }
      break;
  }

  let oncePerSeen = false;
  rule.limits.forEach((limit, i) => {
    if ("concurrentOpen" in limit) {
      if (effect.kind !== "reserve") {
        issues.push({
          path: `limits.${i}.concurrentOpen`,
          message: "concurrentOpen bounds holds, so only a reserve names it",
        });
      }
      return;
    }
    if ("oncePer" in limit) {
      // One dedupe key per applied rule (`points_posting_keys.dedupe_key`).
      if (oncePerSeen) {
        issues.push({
          path: `limits.${i}.oncePer`,
          message: "a rule names at most one oncePer limit",
        });
      }
      oncePerSeen = true;
    }
    const scope = scopeOf(limit);
    if (!scope) return;
    const field = "oncePer" in limit ? "oncePer" : "countPer.scope";
    scope.forEach((name, j) => {
      if (name === "subject" || name === "beneficiary") return;
      for (const type of rule.trigger) {
        const entry = getPointsFactType(type);
        if (!entry) continue;
        const present =
          name === "ref"
            ? entry.refKind !== "none"
            : Object.hasOwn(entry.attributes, name);
        if (!present) {
          issues.push({
            path: `limits.${i}.${field}.${j}`,
            message: `${type} has no ${name === "ref" ? "ref" : `attribute ${name}`}`,
          });
        }
      }
    });
  });

  return issues;
}
