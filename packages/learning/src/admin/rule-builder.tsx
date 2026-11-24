"use client";

import { useId } from "react";
import { Button, Input, Label, NativeSelect } from "@ds/design-system";
import {
  LEARNING_CONDITION_TYPES,
  LEARNING_RULE_MAX_DEPTH,
  type LearningConditionNode,
  type LearningConditionType,
  type LearningRuleNode,
} from "@ds/schemas";

import { CONDITION_LABEL, RULES_COPY as R } from "./admin-copy";

// 024 EARS-6, EARS-29 — the completion-rule builder: one condition of the
// EARS-3 catalog, or `all` / `any` / «N из M» over conditions and nested groups
// (depth at most 4). The catalog names are the `@ds/schemas` list, so a
// condition type added in code appears here without a screen change; the
// server validator stays the authority over a tree (field errors name the node).

type Kind = "condition" | "all" | "any" | "nOf";

function kindOf(node: LearningRuleNode): Kind {
  if ("all" in node) return "all";
  if ("any" in node) return "any";
  if ("nOf" in node) return "nOf";
  return "condition";
}

function childrenOf(node: LearningRuleNode): LearningRuleNode[] {
  if ("all" in node) return node.all;
  if ("any" in node) return node.any;
  if ("nOf" in node) return node.nOf.of;
  return [];
}

function group(kind: Exclude<Kind, "condition">, of: LearningRuleNode[], n = 1) {
  if (kind === "all") return { all: of };
  if (kind === "any") return { any: of };
  return { nOf: { n: Math.min(Math.max(1, n), of.length), of } };
}

/** A condition of a type with the parameters that type reads, defaulted. */
function conditionOf(type: string): LearningConditionNode {
  if (type === "watched-at-least" || type === "listened-at-least")
    return { condition: type, percent: 90 };
  if (type === "test-passed") return { condition: type, test: "exit" };
  return { condition: type };
}

const NEW_CONDITION: LearningConditionNode = { condition: "viewed" };

export function RuleBuilder({
  value,
  onChange,
  path = "",
  depth = 1,
}: {
  value: LearningRuleNode;
  onChange: (next: LearningRuleNode) => void;
  /** The node's position («2», «2.1»), empty at the root. */
  path?: string;
  depth?: number;
}) {
  const id = useId();
  const kind = kindOf(value);
  const kids = childrenOf(value);
  const n = "nOf" in value ? value.nOf.n : 1;

  function setKind(next: Kind) {
    if (next === kind) return;
    if (next === "condition") {
      const first = kids.find((k) => kindOf(k) === "condition");
      onChange(first ?? conditionOf("all-steps-done"));
      return;
    }
    onChange(group(next, kind === "condition" ? [value] : kids, n));
  }

  function setChildren(of: LearningRuleNode[]) {
    if (kind === "condition") return;
    onChange(group(kind, of, n));
  }

  const childPath = (i: number) => (path ? `${path}.${i + 1}` : `${i + 1}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-kind`}>
          {path ? R.groupKind(path) : R.ruleKind}
        </Label>
        <NativeSelect
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          {(["condition", "all", "any", "nOf"] as const).map((k) => (
            <option key={k} value={k}>
              {R.ruleKinds[k]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {kind === "condition" ? (
        <ConditionFields
          node={value as LearningConditionNode}
          label={path ? R.condition(path) : R.condition("").trim()}
          path={path}
          onChange={onChange}
        />
      ) : (
        <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
          {kind === "nOf" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-n`}>
                {path ? `${R.groupKind(path)}: ${R.nOfN}` : R.nOfN}
              </Label>
              <Input
                id={`${id}-n`}
                type="number"
                min={1}
                max={kids.length}
                value={n}
                onChange={(e) =>
                  onChange(group("nOf", kids, Number(e.target.value)))
                }
              />
            </div>
          ) : null}
          <ol className="flex flex-col gap-3">
            {kids.map((child, i) => (
              <li key={i} className="flex flex-col gap-2">
                {kindOf(child) === "condition" ? (
                  <ConditionFields
                    node={child as LearningConditionNode}
                    label={R.condition(childPath(i))}
                    path={childPath(i)}
                    onChange={(next) =>
                      setChildren(kids.map((k, j) => (j === i ? next : k)))
                    }
                  />
                ) : (
                  <RuleBuilder
                    value={child}
                    path={childPath(i)}
                    depth={depth + 1}
                    onChange={(next) =>
                      setChildren(kids.map((k, j) => (j === i ? next : k)))
                    }
                  />
                )}
                {kids.length > 1 ? (
                  <div>
                    <Button
                      type="button"
                      variant="link"
                      aria-label={R.removeCondition(childPath(i))}
                      onClick={() => setChildren(kids.filter((_, j) => j !== i))}
                    >
                      {R.removeCondition(childPath(i))}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setChildren([...kids, NEW_CONDITION])}
            >
              {R.addCondition}
            </Button>
            {depth < LEARNING_RULE_MAX_DEPTH ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setChildren([...kids, { all: [NEW_CONDITION] }])
                }
              >
                {R.addGroup}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionFields({
  node,
  label,
  path,
  onChange,
}: {
  node: LearningConditionNode;
  label: string;
  path: string;
  onChange: (next: LearningConditionNode) => void;
}) {
  const id = useId();
  const at = path || "1";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${id}-type`}>{label}</Label>
        <NativeSelect
          id={`${id}-type`}
          value={node.condition}
          onChange={(e) => onChange(conditionOf(e.target.value))}
        >
          {LEARNING_CONDITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONDITION_LABEL[type as LearningConditionType]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {node.percent !== undefined ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-percent`}>{R.conditionPercent(at)}</Label>
          <Input
            id={`${id}-percent`}
            type="number"
            min={1}
            max={100}
            value={node.percent}
            onChange={(e) =>
              onChange({ ...node, percent: Number(e.target.value) })
            }
          />
        </div>
      ) : null}
      {node.condition === "test-passed" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-test`}>{R.conditionTest(at)}</Label>
          <NativeSelect
            id={`${id}-test`}
            value={node.test ?? "exit"}
            onChange={(e) => onChange({ ...node, test: e.target.value })}
          >
            {Object.entries(R.testKinds).map(([v, words]) => (
              <option key={v} value={v}>
                {words}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
}
