import { z } from "zod";

// 025 EARS-2 / EARS-30 — the consumer read model `PointsAccount`
// (025-requirements «Read models»), served by `GET /v1/me/points`. A fold over
// `points_postings`, never a stored column; this package holds only the shape
// (capability registry row «Attention points engine (025)»).
//
// EARS-30 vocabulary: every Pul amount is a non-negative integer and the Pul
// block names its unit `Pul`; no field states «free» or money — the money
// statement is the consumer's, independent of any Pul amount.

/** The unit every Pul amount of the engine is expressed in (EARS-30). */
export const PUL_UNIT = "Pul" as const;

const PointsAmountSchema = z.number().int().nonnegative();

export const PointsAccountSchema = z.strictObject({
  /** The person the account belongs to (`users.id`). */
  personId: z.uuid(),
  pul: z.strictObject({
    unit: z.literal(PUL_UNIT),
    /** Pul the person may spend: Σ credits − Σ debits of the person account. */
    available: PointsAmountSchema,
    /** The person's own Pul held by open reserves (025-design §5). */
    reserved: PointsAmountSchema,
  }),
  bre: PointsAmountSchema,
  con: PointsAmountSchema,
  advance: z.strictObject({
    /** Number of open advance obligations. */
    open: PointsAmountSchema,
    /** Pul still owed to the advance account across the open obligations. */
    remaining: PointsAmountSchema,
  }),
  status: z.enum(["open", "closed"]),
});
export type PointsAccount = z.infer<typeof PointsAccountSchema>;
