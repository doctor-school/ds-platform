import { z } from "zod";
import { PUL_UNIT } from "./points-account.schema.js";

// 025 attention-points engine — the price list and the gating decision
// (EARS-26, EARS-13; 025-design production amendment A, E, F; owner decision
// 1: spend runs over items of ANY kind, not events only).
//
// The item-kind catalog is CODE: registering a kind, and whether it may carry
// a Pul price, is a developer change made when that kind's owner spec says so
// (025 requirements, Open questions «Pul prices on courses and trainings»).
// Setting an item's price is an admin write (`PUT /v1/admin/points/prices/:itemRef`).

/**
 * The registered item kinds. `priceable: false` kinds accept mode `open`
 * only — the PRD's «lessons never cost Pul» (EARS-26, Invariants).
 */
export const POINTS_ITEM_KINDS = {
  event: { priceable: true },
  course: { priceable: true },
  training: { priceable: true },
  internship: { priceable: true },
  "offline-event": { priceable: true },
  lesson: { priceable: false },
  module: { priceable: false },
} as const satisfies Record<string, { priceable: boolean }>;
export type PointsItemKind = keyof typeof POINTS_ITEM_KINDS;
export const PointsItemKindSchema = z.enum(
  Object.keys(POINTS_ITEM_KINDS) as [PointsItemKind, ...PointsItemKind[]],
);

/** EARS-26 — the gating mode of a price-list row. */
export const POINTS_GATING_MODES = ["open", "advance", "threshold"] as const;
export const PointsGatingModeSchema = z.enum(POINTS_GATING_MODES);
export type PointsGatingMode = z.infer<typeof PointsGatingModeSchema>;

/**
 * An item ref as a fact names it (`PointsRecordFact.ref`): an event's id, or
 * `<kind>:<id>` for any other item — letters, digits and `:._-`, at most 256
 * characters. The HTTP layer already refuses a path segment over 100
 * characters (414) before the route runs.
 */
export const PointsItemRefSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/, "an item ref: letters, digits and :._-");

/** EARS-26 — body of `PUT /v1/admin/points/prices/:itemRef`. */
export const PutPointsPriceRequestSchema = z.strictObject({
  itemKind: PointsItemKindSchema,
  mode: PointsGatingModeSchema,
  /** Pul price, a non-negative integer [standard 50, premium or limited-seat 100]. */
  pulCost: z.number().int().min(0).max(100_000),
  limitedSeats: z.boolean().default(false),
});
export type PutPointsPriceRequest = z.input<typeof PutPointsPriceRequestSchema>;

/** EARS-26 — a stored price-list row. */
export const PointsPriceSchema = z.strictObject({
  itemRef: PointsItemRefSchema,
  itemKind: PointsItemKindSchema,
  mode: PointsGatingModeSchema,
  pulCost: z.number().int().min(0),
  unit: z.literal(PUL_UNIT),
  limitedSeats: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type PointsPrice = z.infer<typeof PointsPriceSchema>;

/**
 * EARS-13 — the gating decision of one item for the calling doctor: `quote`
 * (EARS-41) of a draft `registration.created`. Every amount is a
 * non-negative integer in Pul (EARS-30); no field states «free».
 *
 *  - `open`: no price-list row, an `open` row or a zero price;
 *  - `reserve`: the available Pul covers the price, held from the balance;
 *  - `reserve-with-advance`: advance mode, the shortfall fits the advance cap
 *    (lands with the advance slice #3811 — this read does not answer it yet);
 *  - `short`: `shortfall` = price − available, with the `earnHint`;
 *  - `blocked`: the sign-up's `record` would refuse for a state of the
 *    doctor's account other than the price — `reason` is the problem slug
 *    the sign-up would raise (`points-phone-unverified`,
 *    `points-reserve-limit`, `points-account-closed`). The read is a read: it
 *    answers every valid request with a decision, never with that problem.
 */
export const POINTS_GATING_BLOCKED_REASONS = [
  "points-phone-unverified",
  "points-reserve-limit",
  "points-account-closed",
] as const;
export const PointsGatingBlockedReasonSchema = z.enum(
  POINTS_GATING_BLOCKED_REASONS,
);
export type PointsGatingBlockedReason = z.infer<
  typeof PointsGatingBlockedReasonSchema
>;

export const PointsGatingDecisionSchema = z.strictObject({
  itemRef: PointsItemRefSchema,
  mode: PointsGatingModeSchema,
  pulCost: z.number().int().min(0),
  unit: z.literal(PUL_UNIT),
  decision: z.enum([
    "open",
    "reserve",
    "reserve-with-advance",
    "short",
    "blocked",
  ]),
  /** `blocked` only — the problem slug the sign-up would raise. */
  reason: PointsGatingBlockedReasonSchema.optional(),
  reservedFromBalance: z.number().int().min(0),
  coveredByAdvance: z.number().int().min(0),
  shortfall: z.number().int().min(0),
  earnHint: z
    .strictObject({
      /** shortfall + the remaining open obligations (EARS-20 nets them first). */
      pulToEarn: z.number().int().min(0),
      /** ceil(pulToEarn / the Pul credit of the active `accrual.lesson`); null without one. */
      lessonsNeeded: z.number().int().min(0).nullable(),
    })
    .optional(),
});
export type PointsGatingDecision = z.infer<typeof PointsGatingDecisionSchema>;

/** EARS-17 / EARS-13 — the earn hint a `points-threshold-short` problem carries. */
export type PointsEarnHint = NonNullable<PointsGatingDecision["earnHint"]>;
