import { z } from "zod";
import { PointsFactTypeNameSchema } from "./fact-types.js";

// 025 attention-points engine — the producer's fact and the evaluation trace
// (EARS-33, EARS-40; 025-design production amendment D).
//
// A fact says only WHAT happened: it has no field for an amount, a rule id, a
// denomination or a dedupe key — those are the rules' (admin data). Its
// `attributes` are parsed against the catalog entry of its `type`
// (`pointsFactAttributesSchema`); `attribution` is written to postings only
// and read by no rule.

/** EARS-33 — `points.record(tx, fact)` input. */
export const PointsRecordFactSchema = z.strictObject({
  /** A registered fact type (EARS-32). */
  type: PointsFactTypeNameSchema,
  /** Globally unique per fact; a replay (retry, offline sync) reuses it (amended EARS-4). */
  eventId: z.string().min(1).max(200),
  /** The subject: the person whose account the fact concerns. */
  personId: z.uuid(),
  /** What the fact is about — required iff the catalog entry has a ref kind other than `none`. */
  ref: z.string().min(1).max(256).optional(),
  occurredAt: z.coerce.date(),
  /** Catalog-declared attributes only (strict per type). */
  attributes: z.record(z.string(), z.unknown()).default({}),
  projectId: z.uuid().optional(),
  output: z
    .strictObject({ type: z.string().min(1).max(128), id: z.uuid() })
    .optional(),
  /** Written to postings only; never journaled, never read by a rule. */
  attribution: z
    .strictObject({
      organisationId: z.uuid().optional(),
      memberId: z.uuid().optional(),
    })
    .optional(),
});
export type PointsRecordFact = z.input<typeof PointsRecordFactSchema>;
export type PointsParsedRecordFact = z.output<typeof PointsRecordFactSchema>;

/** A verdict of one rule considered for a fact (025-design D «Trace»). */
export const POINTS_TRACE_VERDICTS = [
  "applied",
  "not-valid",
  "inactive",
  "condition-false",
  "limit-reached",
  "superseded",
  "no-open-hold",
] as const;
export type PointsTraceVerdict = (typeof POINTS_TRACE_VERDICTS)[number];

/** One limit's verdict (EARS-36). */
export const PointsTraceLimitSchema = z.strictObject({
  kind: z.enum(["oncePer", "countPer", "concurrentOpen", "unlimited"]),
  verdict: z.enum(["pass", "limit-reached"]),
  /** `oncePer`: the dedupe key `<limit key>:<scope values>`. */
  key: z.string().optional(),
});

/** EARS-40 — one entry of a journal row's evaluation trace. */
export const PointsTraceEntrySchema = z.strictObject({
  ruleId: z.string(),
  version: z.number().int().positive(),
  trigger: z.literal(true),
  active: z.boolean(),
  valid: z.boolean().nullable(),
  /** null when not evaluated (inactive or outside the window). */
  condition: z.boolean().nullable(),
  limits: z.array(PointsTraceLimitSchema),
  /** EARS-38 — null for a rule with no exclusive group or not reaching stacking. */
  stacking: z.enum(["won", "superseded"]).nullable(),
  verdict: z.enum(POINTS_TRACE_VERDICTS),
  /** The ledger fact `<fact event id>#<rule id>` of an applied rule. */
  ledgerEventId: z.string().optional(),
});
export type PointsTraceEntry = z.infer<typeof PointsTraceEntrySchema>;

/** EARS-33 — the outcome of `record`. */
export const PointsRecordOutcomeSchema = z.enum([
  "applied",
  "duplicate",
  "no-effect",
]);
export type PointsRecordOutcome = z.infer<typeof PointsRecordOutcomeSchema>;
