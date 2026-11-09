import { z } from "zod";

// 025 attention-points engine — the condition AST (EARS-34; 025-design C).
// A bounded JSON tree validated by zod: combinators all / any / not,
// comparisons eq / ne / gt / gte / lt / lte / in, operands attr / pred /
// setting / literal. No loop, no user-defined function, no string evaluation.
// This module is the SHAPE only; the publish-time type check, the size bounds
// and the pure evaluator live in apps/api/src/points/engine/condition.ts.

/** Language constants (not settings): 025-design C. */
export const POINTS_CONDITION_BOUNDS = {
  maxDepth: 8,
  maxNodes: 64,
  maxInList: 100,
} as const;

export type PointsConditionLiteral = string | number | boolean | null;

export type PointsConditionOperand =
  | PointsConditionLiteral
  | { attr: string }
  | { pred: string; args?: Record<string, PointsConditionOperand> | undefined }
  | { setting: string };

export const POINTS_CONDITION_COMPARISONS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;
export type PointsConditionComparison =
  (typeof POINTS_CONDITION_COMPARISONS)[number];

export type PointsCondition =
  | { all: PointsCondition[] }
  | { any: PointsCondition[] }
  | { not: PointsCondition }
  | { eq: [PointsConditionOperand, PointsConditionOperand] }
  | { ne: [PointsConditionOperand, PointsConditionOperand] }
  | { gt: [PointsConditionOperand, PointsConditionOperand] }
  | { gte: [PointsConditionOperand, PointsConditionOperand] }
  | { lt: [PointsConditionOperand, PointsConditionOperand] }
  | { lte: [PointsConditionOperand, PointsConditionOperand] }
  | { in: [PointsConditionOperand, PointsConditionLiteral[]] };

const name = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9-]*)*$/, "a dotted name");

export const PointsConditionLiteralSchema = z.union([
  z.string().max(256),
  z.number().int(),
  z.boolean(),
  z.null(),
]);

export const PointsConditionOperandSchema: z.ZodType<PointsConditionOperand> =
  z.lazy(() =>
    z.union([
      PointsConditionLiteralSchema,
      z.strictObject({ attr: name }),
      z.strictObject({
        pred: name,
        args: z.record(name, PointsConditionOperandSchema).optional(),
      }),
      z.strictObject({ setting: name }),
    ]),
  );

const pair = z.tuple([
  PointsConditionOperandSchema,
  PointsConditionOperandSchema,
]);

export const PointsConditionSchema: z.ZodType<PointsCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(PointsConditionSchema).min(1) }),
    z.strictObject({ any: z.array(PointsConditionSchema).min(1) }),
    z.strictObject({ not: PointsConditionSchema }),
    z.strictObject({ eq: pair }),
    z.strictObject({ ne: pair }),
    z.strictObject({ gt: pair }),
    z.strictObject({ gte: pair }),
    z.strictObject({ lt: pair }),
    z.strictObject({ lte: pair }),
    z.strictObject({
      in: z.tuple([
        PointsConditionOperandSchema,
        z
          .array(PointsConditionLiteralSchema)
          .min(1)
          .max(POINTS_CONDITION_BOUNDS.maxInList),
      ]),
    }),
  ]),
);
