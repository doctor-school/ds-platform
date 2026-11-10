import { z } from "zod";

// 025 attention-points engine — ledger-core contracts (025-design §1/§2).
// These are the fact / outcome shapes every later 025 slice (rule book #3808,
// reserve/spend #3810, corrections #3814) hands to the one ledger write entry
// point in `apps/api/src/points/`. No points LOGIC lives in this package
// (capability registry row «Attention points engine (025)») — only shapes.

/** Denominations of the `attention_points` unit (ADR-0016 §6). */
export const PointsDenominationSchema = z.enum(["pul", "bre", "con"]);
export type PointsDenomination = z.infer<typeof PointsDenominationSchema>;

/** System accounts, one per unit (025-design §2 «Accounts»). */
export const PointsSystemCodeSchema = z.enum([
  "issuance",
  "reserve",
  "sink",
  "advance",
]);
export type PointsSystemCode = z.infer<typeof PointsSystemCodeSchema>;

/**
 * Which account a leg debits or credits. A person resolves to their ONE
 * attention-points account (EARS-1); a system account by its code.
 */
export const PointsAccountRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("person"), personId: z.uuid() }),
  z.strictObject({ kind: z.literal("system"), code: PointsSystemCodeSchema }),
]);
export type PointsAccountRef = z.infer<typeof PointsAccountRefSchema>;

/** One posting of a fact (EARS-3 / EARS-27). `amount` is a positive integer; direction is the debit/credit pair. */
export const PointsPostingLegSchema = z.strictObject({
  /** Names the posting within its fact: entry kind + denomination (`accrual:pul`, `reserve:balance`, …). */
  leg: z.string().min(1).max(128),
  debit: PointsAccountRefSchema,
  credit: PointsAccountRefSchema,
  denomination: PointsDenominationSchema,
  amount: z.number().int().positive(),
  ruleId: z.string().min(1).max(128),
  ruleVersion: z.number().int().positive(),
  action: z.string().min(1).max(128).optional(),
  projectId: z.uuid().optional(),
  outputType: z.string().min(1).max(128).optional(),
  outputId: z.uuid().optional(),
  attributedOrganisationId: z.uuid().optional(),
  attributedMemberId: z.uuid().optional(),
  /** A compensating posting names the reversed posting by its full key. */
  reverses: z
    .strictObject({ postingId: z.uuid(), occurredAt: z.coerce.date() })
    .optional(),
});
export type PointsPostingLeg = z.infer<typeof PointsPostingLegSchema>;

/**
 * One domain fact = one `event_id` (025-design §2). `dedupeKey` is the PRD key
 * `<personId>:<contentRef>:<action>` for an accrual fact and absent for a
 * spend fact. Every posting of the fact shares `occurredAt`.
 */
export const PointsFactSchema = z
  .strictObject({
    eventId: z.string().min(1).max(256),
    dedupeKey: z.string().min(1).max(512).optional(),
    occurredAt: z.coerce.date(),
    legs: z.array(PointsPostingLegSchema).min(1),
  })
  .refine(
    (fact) => new Set(fact.legs.map((l) => l.leg)).size === fact.legs.length,
    { message: "every leg of a fact has a distinct name", path: ["legs"] },
  );
export type PointsFact = z.infer<typeof PointsFactSchema>;

/** A posting as written (the ledger's own record). */
export const PointsPostingSchema = z.strictObject({
  id: z.uuid(),
  eventId: z.string(),
  leg: z.string(),
  debitAccountId: z.uuid(),
  creditAccountId: z.uuid(),
  denomination: PointsDenominationSchema,
  amount: z.number().int().positive(),
  ruleId: z.string(),
  ruleVersion: z.number().int().positive(),
  occurredAt: z.date(),
  recordedAt: z.date(),
});
export type PointsPosting = z.infer<typeof PointsPostingSchema>;

/**
 * The write outcome. `duplicate` (EARS-4) references the postings of the fact
 * that already holds this `event_id` or dedupe key; nothing new was written.
 */
export const PointsPostOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("posted"),
    postings: z.array(PointsPostingSchema),
  }),
  z.strictObject({
    status: z.literal("duplicate"),
    postings: z.array(PointsPostingSchema),
  }),
]);
export type PointsPostOutcome = z.infer<typeof PointsPostOutcomeSchema>;

/**
 * Stable ledger-core error codes (RFC 7807 `errorCode`; the problem `type` is
 * the kebab-case form, e.g. `points-account-closed`).
 *  - POINTS_ACCOUNT_CLOSED — EARS-31: the person account is closed.
 *  - POINTS_INSUFFICIENT_PUL — EARS-22: the fact would take available Pul
 *    below zero. A consumer slice may translate it to its own decision
 *    (e.g. #3810's `points-threshold-short` with an earn hint).
 *  - POINTS_OCCURRED_AT_FUTURE — EARS-27: the fact's `occurredAt` lies more
 *    than one day past now (beyond clock skew); a far-future posting would
 *    land in the default partition and block monthly partition creation.
 *  - POINTS_BRE_CON_DEBIT — EARS-12: a leg debits Bre or Con from a person
 *    account without reversing a specific earlier posting (no penalty, no
 *    conversion between denominations).
 *  - POINTS_PHONE_UNVERIFIED — EARS-5 / EARS-35: a debit-side effect for a
 *    person whose phone is not verified; the whole fact is refused.
 *  - POINTS_RULE_PARAMETERS_INVALID — amended EARS-25: the body fails the one
 *    rule schema or a catalog check (field errors in `errors`, paths relative
 *    to the body, e.g. `condition.all.0.eq.0`).
 *  - POINTS_RULE_RETIRED — amended EARS-25: a publish to a 0059 id the engine
 *    retired (025-design G).
 *  - POINTS_RULE_EFFECTIVE_FROM_PAST — EARS-25: a version takes effect from
 *    now or later, never retroactively.
 *  - POINTS_HISTORY_QUERY_INVALID — EARS-46: the posting-history page query
 *    is out of range — a `limit` outside `POINTS_POSTING_HISTORY_LIMIT` or a
 *    `cursor` that is not a `nextCursor` the route issued.
 *  - POINTS_FACTS_QUERY_INVALID — EARS-45: the admin fact-journal page query
 *    is invalid — a missing or non-uuid `personId`, a `limit` outside
 *    `POINTS_FACT_JOURNAL_LIMIT` or a `cursor` the route did not issue.
 *  - POINTS_THRESHOLD_SHORT — EARS-17: a `reserve` on a threshold-mode item
 *    (or an advance-mode item beyond the advance) with available Pul below
 *    the price; the body carries `shortfall` and `earnHint`.
 *  - POINTS_RESERVE_LIMIT — EARS-21: a `reserve` beyond the `concurrentOpen`
 *    limit of open holds on limited-seat items.
 *  - POINTS_ITEM_REF_INVALID — EARS-13 / EARS-26: the `:itemRef` of the
 *    gating read or the price-list write is not an item ref
 *    (`PointsItemRefSchema`).
 *  - POINTS_GATING_INVALID — EARS-26: a price-list row the item's kind or
 *    accreditation refuses (any mode but `open` for a lesson, a module or an
 *    НМО-accredited event), or a row for an item that does not exist.
 */
export const POINTS_LEDGER_ERROR_CODES = [
  "POINTS_ACCOUNT_CLOSED",
  "POINTS_INSUFFICIENT_PUL",
  "POINTS_OCCURRED_AT_FUTURE",
  "POINTS_BRE_CON_DEBIT",
  "POINTS_PHONE_UNVERIFIED",
  "POINTS_RULE_PARAMETERS_INVALID",
  "POINTS_RULE_RETIRED",
  "POINTS_RULE_EFFECTIVE_FROM_PAST",
  "POINTS_HISTORY_QUERY_INVALID",
  "POINTS_FACTS_QUERY_INVALID",
  "POINTS_THRESHOLD_SHORT",
  "POINTS_RESERVE_LIMIT",
  "POINTS_GATING_INVALID",
  "POINTS_ITEM_REF_INVALID",
  "POINTS_STARTER_BONUS_NO_RULE",
] as const;
export const PointsLedgerErrorCodeSchema = z.enum(POINTS_LEDGER_ERROR_CODES);
export type PointsLedgerErrorCode = z.infer<typeof PointsLedgerErrorCodeSchema>;

export const PointsLedgerProblemDetailsSchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errorCode: PointsLedgerErrorCodeSchema,
  errors: z
    .array(z.strictObject({ path: z.string(), message: z.string() }))
    .optional(),
  /** EARS-17 — `points-threshold-short` only: price − available Pul. */
  shortfall: z.number().int().min(0).optional(),
  /** EARS-17 — `points-threshold-short` only: the earn hint of EARS-13. */
  earnHint: z
    .strictObject({
      pulToEarn: z.number().int().min(0),
      lessonsNeeded: z.number().int().min(0).nullable(),
    })
    .optional(),
  traceId: z.string(),
});
export type PointsLedgerProblemDetails = z.infer<
  typeof PointsLedgerProblemDetailsSchema
>;
