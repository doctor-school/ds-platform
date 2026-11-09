import {
  getPointsFactType,
  POINTS_CONDITION_BOUNDS,
  POINTS_PREDICATES,
  POINTS_SETTING_IDS,
  POINTS_SETTING_VALUE_TYPE,
  type PointsCondition,
  type PointsConditionLiteral,
  type PointsConditionOperand,
  type PointsPredicateDeclaration,
  type PointsValueType,
} from "@ds/schemas";

// 025 EARS-34 — the condition language of the rule engine (025-design C):
// the language bounds, the publish-time type check against a trigger fact
// type's declared attributes, the registered predicates and the settings, and
// the pure evaluator. The evaluator reads nothing but its operands: attribute
// values and settings are handed in, predicate values come from an injected
// `PointsPredicateResolver` (memoisation, the journal-including-this-fact
// timing and the locks are the resolver's contract, owned by the engine).

/** A runtime operand value. Instants arrive as ISO strings or Dates. */
export type ConditionValue = string | number | boolean | null | Date;

/** The injected predicate lookup (EARS-34): read-only, side-effect-free. */
export interface PointsPredicateResolver {
  resolve(
    name: string,
    args: Readonly<Record<string, ConditionValue>>,
  ): Promise<ConditionValue>;
}

/** What a condition may read, by name and type (one trigger fact type). */
export interface ConditionTypeContext {
  readonly attributes: Readonly<Record<string, PointsValueType>>;
  readonly predicates: Readonly<Record<string, PointsPredicateDeclaration>>;
  readonly settings: Readonly<Record<string, PointsValueType>>;
}

export interface ConditionEnvironment {
  /** The type context the condition was checked against (instant coercion). */
  readonly types: ConditionTypeContext;
  /** The fact's catalog-declared attributes. */
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly predicates: PointsPredicateResolver;
  /** The setting values active at the fact's occurredAt. */
  readonly settings: Readonly<Record<string, number>>;
}

export interface ConditionIssue {
  /** Path inside the condition (prefix with `condition` for a rule body). */
  readonly path: (string | number)[];
  readonly message: string;
}

type Path = (string | number)[];

const COMBINATORS = ["all", "any", "not"] as const;
type Ordering = "gt" | "gte" | "lt" | "lte";

function opOf(cond: PointsCondition): string {
  return Object.keys(cond)[0] as string;
}

function children(cond: PointsCondition): PointsCondition[] {
  if ("all" in cond) return cond.all;
  if ("any" in cond) return cond.any;
  if ("not" in cond) return [cond.not];
  return [];
}

function operandsOf(cond: PointsCondition): PointsConditionOperand[] {
  const op = opOf(cond);
  if ((COMBINATORS as readonly string[]).includes(op)) return [];
  if ("in" in cond) return [cond.in[0]];
  return (cond as Record<string, PointsConditionOperand[]>)[op] ?? [];
}

function isLiteral(
  operand: PointsConditionOperand,
): operand is PointsConditionLiteral {
  return operand === null || typeof operand !== "object";
}

function countOperand(operand: PointsConditionOperand): number {
  if (isLiteral(operand) || !("pred" in operand)) return 1;
  return (
    1 +
    Object.values(operand.args ?? {}).reduce<number>(
      (sum, arg) => sum + countOperand(arg),
      0,
    )
  );
}

/**
 * The language bounds (025-design C): depth ≤ 8 condition levels, ≤ 64
 * nodes (every condition node and every operand, predicate arguments
 * included; the literals of an `in` list are bounded separately), `in` lists
 * ≤ 100 literals.
 */
export function checkConditionBounds(cond: PointsCondition): ConditionIssue[] {
  const { maxDepth, maxNodes, maxInList } = POINTS_CONDITION_BOUNDS;
  const issues: ConditionIssue[] = [];
  let nodes = 0;
  const walk = (node: PointsCondition, path: Path, depth: number) => {
    if (depth > maxDepth) {
      issues.push({
        path,
        message: `the condition exceeds the depth of ${maxDepth}`,
      });
      return;
    }
    nodes += 1;
    for (const operand of operandsOf(node)) nodes += countOperand(operand);
    if ("in" in node && node.in[1].length > maxInList) {
      issues.push({
        path: [...path, "in", 1],
        message: `an in-list holds at most ${maxInList} literals`,
      });
    }
    const op = opOf(node);
    if (op === "not") {
      walk((node as { not: PointsCondition }).not, [...path, "not"], depth + 1);
    } else {
      children(node).forEach((child, i) =>
        walk(child, [...path, op, i], depth + 1),
      );
    }
  };
  walk(cond, [], 1);
  if (nodes > maxNodes) {
    issues.push({
      path: [],
      message: `the condition exceeds ${maxNodes} nodes`,
    });
  }
  return issues;
}

// ── type check ─────────────────────────────────────────────────────────────

/** A static type; `null` is the type of the null literal. */
type StaticType =
  (PointsValueType & { literal?: PointsConditionLiteral }) | { type: "null" };

const isoInstant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function describe(t: StaticType): string {
  if (t.type === "null") return "null";
  return t.nullable ? `${t.type} | null` : t.type;
}

function literalType(literal: PointsConditionLiteral): StaticType {
  if (literal === null) return { type: "null" };
  if (typeof literal === "string") return { type: "string", literal };
  if (typeof literal === "number") return { type: "integer", literal };
  return { type: "boolean", literal };
}

/** A string literal that is an ISO instant reads as an instant beside one. */
function unify(a: StaticType, b: StaticType): [StaticType, StaticType] {
  const asInstant = (x: StaticType, other: StaticType): StaticType =>
    x.type === "string" &&
    other.type === "instant" &&
    "literal" in x &&
    typeof x.literal === "string" &&
    isoInstant.test(x.literal) &&
    !Number.isNaN(Date.parse(x.literal))
      ? { type: "instant" }
      : x;
  return [asInstant(a, b), asInstant(b, a)];
}

function typeOperand(
  operand: PointsConditionOperand,
  ctx: ConditionTypeContext,
  path: Path,
  issues: ConditionIssue[],
): StaticType | undefined {
  if (isLiteral(operand)) return literalType(operand);
  if ("attr" in operand) {
    const decl = ctx.attributes[operand.attr];
    if (!decl) {
      issues.push({
        path: [...path, "attr"],
        message: `unknown attribute ${operand.attr}`,
      });
      return undefined;
    }
    return decl;
  }
  if ("setting" in operand) {
    const decl = ctx.settings[operand.setting];
    if (!decl) {
      issues.push({
        path: [...path, "setting"],
        message: `unknown setting ${operand.setting}`,
      });
      return undefined;
    }
    return decl;
  }
  const decl = ctx.predicates[operand.pred];
  if (!decl) {
    issues.push({
      path: [...path, "pred"],
      message: `unknown predicate ${operand.pred}`,
    });
    return undefined;
  }
  const declared = decl.args ?? {};
  const given = operand.args ?? {};
  for (const [name, arg] of Object.entries(given)) {
    const argPath = [...path, "args", name];
    const want = declared[name];
    if (!want) {
      issues.push({
        path: argPath,
        message: `unknown argument ${name} of ${operand.pred}`,
      });
      continue;
    }
    const got = typeOperand(arg, ctx, argPath, issues);
    if (got && !assignable(got, want)) {
      issues.push({
        path: argPath,
        message: `argument ${name} of ${operand.pred} is ${describe(want)}, got ${describe(got)}`,
      });
    }
  }
  for (const name of Object.keys(declared)) {
    if (!(name in given)) {
      issues.push({
        path: [...path, "args", name],
        message: `missing argument ${name} of ${operand.pred}`,
      });
    }
  }
  return decl.result;
}

function assignable(got: StaticType, want: PointsValueType): boolean {
  if (got.type === "null") return want.nullable === true;
  const [g] = unify(got, want);
  if (g.type !== want.type) return false;
  return !("nullable" in g && g.nullable === true && want.nullable !== true);
}

function checkEquality(
  a: StaticType,
  b: StaticType,
  path: Path,
  issues: ConditionIssue[],
) {
  if (a.type === "null" || b.type === "null") {
    const other = a.type === "null" ? b : a;
    if (other.type !== "null" && !other.nullable) {
      issues.push({
        path,
        message: `compares ${describe(other)} with null, but it is not nullable`,
      });
    }
    return;
  }
  const [x, y] = unify(a, b);
  if (x.type !== y.type) {
    issues.push({
      path,
      message: `compares ${describe(x)} with ${describe(y)}`,
    });
  }
}

function checkOrdering(
  a: StaticType,
  b: StaticType,
  path: Path,
  issues: ConditionIssue[],
) {
  const [x, y] = unify(a, b);
  const pair = [x, y];
  for (const [i, t] of pair.entries()) {
    if (t.type === "integer" || t.type === "instant") continue;
    // A non-ISO string beside an instant is a mismatch, not a bad operand.
    const other = pair[1 - i] as StaticType;
    if (t.type === "string" && other.type === "instant") continue;
    issues.push({
      path: [...path, i],
      message: `an ordering takes an integer or instant, got ${describe(t)}`,
    });
    return;
  }
  if (x.type !== y.type) {
    issues.push({
      path,
      message: `compares ${describe(x)} with ${describe(y)} (an instant is an ISO-8601 string with an offset)`,
    });
  }
}

/**
 * EARS-34 — type-check a condition against one type context; [] when it is
 * well-typed. Over-bound trees are refused by their bound issues first.
 */
export function typecheckCondition(
  cond: PointsCondition,
  ctx: ConditionTypeContext,
): ConditionIssue[] {
  const bounds = checkConditionBounds(cond);
  if (bounds.length > 0) return bounds;
  const issues: ConditionIssue[] = [];
  const walk = (node: PointsCondition, path: Path) => {
    const op = opOf(node);
    if (op === "not") {
      walk((node as { not: PointsCondition }).not, [...path, "not"]);
      return;
    }
    if (op === "all" || op === "any") {
      children(node).forEach((child, i) => walk(child, [...path, op, i]));
      return;
    }
    const at = [...path, op];
    if ("in" in node) {
      const [operand, list] = node.in;
      const t = typeOperand(operand, ctx, [...at, 0], issues);
      if (!t) return;
      list.forEach((literal, i) => {
        const before = issues.length;
        checkEquality(t, literalType(literal), [...at, 1, i], issues);
        if (issues.length > before && issues[before]) {
          const issue = issues[before];
          issues[before] = {
            path: issue.path,
            message: `${issue.message} (operand is ${describe(t)})`,
          };
        }
      });
      return;
    }
    const [left, right] = (node as Record<string, PointsConditionOperand[]>)[
      op
    ] as [PointsConditionOperand, PointsConditionOperand];
    const a = typeOperand(left, ctx, [...at, 0], issues);
    const b = typeOperand(right, ctx, [...at, 1], issues);
    if (!a || !b) return;
    if (op === "eq" || op === "ne") checkEquality(a, b, at, issues);
    else checkOrdering(a, b, at, issues);
  };
  walk(cond, []);
  return issues;
}

const SETTING_TYPES: Readonly<Record<string, PointsValueType>> =
  Object.fromEntries(
    POINTS_SETTING_IDS.map((id) => [id, POINTS_SETTING_VALUE_TYPE]),
  );

/** The catalog's type context of a registered fact type (EARS-32, EARS-39). */
export function conditionTypeContext(factType: string): ConditionTypeContext {
  const entry = getPointsFactType(factType);
  if (!entry) throw new Error(`unregistered fact type ${factType}`);
  return {
    attributes: entry.attributes,
    predicates: POINTS_PREDICATES,
    settings: SETTING_TYPES,
  };
}

/**
 * EARS-34 / amended EARS-25 — type-check a rule's condition against the
 * attribute schema of EVERY trigger fact type; each issue names the type.
 */
export function typecheckConditionForTriggers(
  cond: PointsCondition,
  triggers: readonly string[],
): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  for (const type of triggers) {
    if (!getPointsFactType(type)) {
      issues.push({ path: [], message: `unregistered fact type ${type}` });
      continue;
    }
    for (const issue of typecheckCondition(cond, conditionTypeContext(type))) {
      issues.push({ path: issue.path, message: `${type}: ${issue.message}` });
    }
  }
  return issues;
}

// ── evaluation ─────────────────────────────────────────────────────────────

interface Typed {
  value: ConditionValue;
  type: StaticType | undefined;
}

async function valueOf(
  operand: PointsConditionOperand,
  env: ConditionEnvironment,
): Promise<Typed> {
  if (isLiteral(operand)) {
    return { value: operand, type: literalType(operand) };
  }
  if ("attr" in operand) {
    const raw = env.attributes[operand.attr];
    return {
      value: raw === undefined ? null : (raw as ConditionValue),
      type: env.types.attributes[operand.attr],
    };
  }
  if ("setting" in operand) {
    const value = env.settings[operand.setting];
    if (value === undefined) {
      throw new Error(
        `setting ${operand.setting} has no active version for this evaluation`,
      );
    }
    return { value, type: POINTS_SETTING_VALUE_TYPE };
  }
  const args: Record<string, ConditionValue> = {};
  for (const [name, arg] of Object.entries(operand.args ?? {})) {
    args[name] = (await valueOf(arg, env)).value;
  }
  return {
    value: await env.predicates.resolve(operand.pred, args),
    type: env.types.predicates[operand.pred]?.result,
  };
}

/** Normalise a pair for comparison: an instant on either side compares as epoch ms. */
function normalise(a: Typed, b: Typed): [ConditionValue, ConditionValue] {
  const instant =
    a.type?.type === "instant" ||
    b.type?.type === "instant" ||
    a.value instanceof Date ||
    b.value instanceof Date;
  const conv = (v: ConditionValue): ConditionValue => {
    if (v instanceof Date) return v.getTime();
    if (instant && typeof v === "string") return Date.parse(v);
    return v;
  };
  return [conv(a.value), conv(b.value)];
}

/**
 * EARS-34 — evaluate a (type-checked) condition; an absent condition is true.
 * Reads nothing but its operands; `all` / `any` short-circuit, so a predicate
 * after a deciding operand is never resolved. An ordering against null is
 * false.
 */
export async function evaluateCondition(
  cond: PointsCondition | undefined,
  env: ConditionEnvironment,
): Promise<boolean> {
  if (cond === undefined) return true;
  if ("all" in cond) {
    for (const child of cond.all) {
      if (!(await evaluateCondition(child, env))) return false;
    }
    return true;
  }
  if ("any" in cond) {
    for (const child of cond.any) {
      if (await evaluateCondition(child, env)) return true;
    }
    return false;
  }
  if ("not" in cond) return !(await evaluateCondition(cond.not, env));
  if ("in" in cond) {
    const operand = await valueOf(cond.in[0], env);
    for (const literal of cond.in[1]) {
      const [x, y] = normalise(operand, {
        value: literal,
        type: literalType(literal),
      });
      if (x === y) return true;
    }
    return false;
  }
  const op = opOf(cond);
  const [left, right] = (cond as Record<string, PointsConditionOperand[]>)[
    op
  ] as [PointsConditionOperand, PointsConditionOperand];
  const [x, y] = normalise(await valueOf(left, env), await valueOf(right, env));
  if (op === "eq") return x === y;
  if (op === "ne") return x !== y;
  if (x === null || y === null) return false;
  if (typeof x !== "number" || typeof y !== "number") {
    throw new Error(`an ordering compares integers or instants (${op})`);
  }
  switch (op as Ordering) {
    case "gt":
      return x > y;
    case "gte":
      return x >= y;
    case "lt":
      return x < y;
    case "lte":
      return x <= y;
  }
}
