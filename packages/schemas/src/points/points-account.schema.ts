import { z } from "zod";
import { PointsDenominationSchema } from "./points-ledger.schema.js";

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

// 025 EARS-46 / EARS-30 — the consumer read model `PostingHistory`
// (025-requirements «Read models»), served by `GET /v1/me/points/postings`:
// the postings of the caller's own person account, newest first by
// (`occurred_at`, `id`). An item carries no attribution field (project,
// output, organisation, member) and no counterparty account — nothing that
// names another person.

/** Page size of the posting history: default and the inclusive bounds. */
export const POINTS_POSTING_HISTORY_LIMIT = {
  default: 50,
  min: 1,
  max: 100,
} as const;

/** `?cursor=&limit=` of `GET /v1/me/points/postings`; out of range is refused. */
export const PointsPostingHistoryQuerySchema = z.object({
  /** The previous page's opaque `nextCursor`. */
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(POINTS_POSTING_HISTORY_LIMIT.min)
    .max(POINTS_POSTING_HISTORY_LIMIT.max)
    .default(POINTS_POSTING_HISTORY_LIMIT.default),
});
export type PointsPostingHistoryQuery = z.infer<
  typeof PointsPostingHistoryQuerySchema
>;

export const PointsPostingHistoryItemSchema = z.strictObject({
  postingId: z.uuid(),
  occurredAt: z.iso.datetime(),
  /** `pul` | `bre` | `con` — the denomination names the amount's unit. */
  denomination: PointsDenominationSchema,
  /** Signed integer from the person's side: credit positive, debit negative. */
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, "a posting moves a non-zero amount"),
  /**
   * The fact type the posting answers (`lesson.completed`, …); null for a
   * ledger posting no fact type produced (a reserve/settle lifecycle leg).
   */
  action: z.string().nullable(),
  /** The content item the fact is about, when it has one; never a person. */
  contentRef: z.string().optional(),
  ruleId: z.string(),
  ruleVersion: z.number().int().positive(),
  /** Set on a compensating posting: the posting it reverses (EARS-28). */
  reversesPostingId: z.uuid().optional(),
});
export type PointsPostingHistoryItem = z.infer<
  typeof PointsPostingHistoryItemSchema
>;

export const PointsPostingHistorySchema = z.strictObject({
  items: z.array(PointsPostingHistoryItemSchema),
  /** Opaque cursor of the next (older) page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type PointsPostingHistory = z.infer<typeof PointsPostingHistorySchema>;
