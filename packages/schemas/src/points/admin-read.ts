import { z } from "zod";
import { POINTS_REF_KINDS, POINTS_VALUE_TYPES } from "./fact-types.js";
import { POINTS_POSTING_HISTORY_LIMIT } from "./points-account.schema.js";
import { PointsRecordOutcomeSchema, PointsTraceEntrySchema } from "./record.js";

// 025 EARS-45 — the admin read models (025-requirements «Read models»):
// `FactTypeCatalog` (`GET /v1/admin/points/fact-types`), `RuleBook`
// (`GET /v1/admin/points/rules`) and `FactJournalPage`
// (`GET /v1/admin/points/facts?personId=…`). Admin role only. The catalog is
// the code registry as declared; the rule book is every rule and setting id
// of `points_rule_versions` with its active version and its full history; a
// journal entry is a `points_facts` row with its evaluation trace as stored
// (EARS-40) — never attribution, never another person's identifier beyond
// what the trace itself holds.

const PointsValueTypeSchema = z.strictObject({
  type: z.enum(POINTS_VALUE_TYPES),
  nullable: z.boolean().optional(),
});

/** A declared fact attribute (`PointsAttributeDeclaration`). */
export const PointsAttributeDeclarationSchema = PointsValueTypeSchema.extend({
  format: z.literal("uuid").optional(),
  enum: z.array(z.string()).min(1).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});

/** One catalog entry (`PointsFactTypeEntry`, EARS-32). */
export const PointsFactTypeEntrySchema = z.strictObject({
  type: z.string(),
  refKind: z.enum(POINTS_REF_KINDS),
  earnsPul: z.boolean(),
  attributes: z.record(z.string(), PointsAttributeDeclarationSchema),
});

/** One registered predicate (`PointsPredicateDeclaration`, EARS-34). */
export const PointsPredicateDeclarationSchema = z.strictObject({
  name: z.string(),
  subject: z.enum(["person", "item"]),
  args: z.record(z.string(), PointsValueTypeSchema).optional(),
  result: PointsValueTypeSchema,
});

/** `FactTypeCatalog` — `GET /v1/admin/points/fact-types` (EARS-45). */
export const PointsFactTypeCatalogSchema = z.strictObject({
  factTypes: z.array(PointsFactTypeEntrySchema),
  predicates: z.array(PointsPredicateDeclarationSchema),
});
export type PointsFactTypeCatalog = z.infer<typeof PointsFactTypeCatalogSchema>;

/** The body kind of a stored version; null on a 0059 v1 row, which predates kinds. */
const PointsRuleVersionKindSchema = z
  .enum(["rule", "setting", "system"])
  .nullable();

/** One stored version of a rule or setting id. */
export const PointsRuleBookVersionSchema = z.strictObject({
  version: z.number().int().positive(),
  kind: PointsRuleVersionKindSchema,
  triggerFactTypes: z.array(z.string()),
  parameters: z.record(z.string(), z.unknown()),
  effectiveFrom: z.iso.datetime(),
  /** The publishing admin's user id; null for a version the platform seeded. */
  publishedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type PointsRuleBookVersion = z.infer<typeof PointsRuleBookVersionSchema>;

/** One rule or setting id with its active version and its history. */
export const PointsRuleBookEntrySchema = z.strictObject({
  ruleId: z.string(),
  /** The id's kind — a version keeps its kind; null when only 0059 v1 rows exist. */
  kind: PointsRuleVersionKindSchema,
  /**
   * The version in effect now — the highest one with `effectiveFrom ≤ now`;
   * null when every version takes effect later.
   */
  activeVersion: z.number().int().positive().nullable(),
  /** Every stored version, in version order. */
  versions: z.array(PointsRuleBookVersionSchema).min(1),
});
export type PointsRuleBookEntry = z.infer<typeof PointsRuleBookEntrySchema>;

/** `RuleBook` — `GET /v1/admin/points/rules` (EARS-45), ordered by rule id. */
export const PointsRuleBookSchema = z.strictObject({
  rules: z.array(PointsRuleBookEntrySchema),
});
export type PointsRuleBook = z.infer<typeof PointsRuleBookSchema>;

/** Page bounds of the fact journal — the same as the posting history (EARS-46). */
export const POINTS_FACT_JOURNAL_LIMIT = POINTS_POSTING_HISTORY_LIMIT;

/** The query of `GET /v1/admin/points/facts`. */
export const PointsFactJournalQuerySchema = z.object({
  personId: z.uuid(),
  /** The previous page's opaque `nextCursor`. */
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(POINTS_FACT_JOURNAL_LIMIT.min)
    .max(POINTS_FACT_JOURNAL_LIMIT.max)
    .default(POINTS_FACT_JOURNAL_LIMIT.default),
});
export type PointsFactJournalQuery = z.infer<
  typeof PointsFactJournalQuerySchema
>;

/** `FactJournalEntry` — one `points_facts` row (EARS-40, EARS-45). */
export const PointsFactJournalEntrySchema = z.strictObject({
  eventId: z.string(),
  type: z.string(),
  /** What the fact is about; absent for a fact about no ref. */
  ref: z.string().optional(),
  occurredAt: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  outcome: PointsRecordOutcomeSchema,
  /** The evaluation trace as stored, one entry per rule considered. */
  trace: z.array(PointsTraceEntrySchema),
});
export type PointsFactJournalEntry = z.infer<
  typeof PointsFactJournalEntrySchema
>;

/** One page of a person's journal, newest first by (`receivedAt`, `eventId`). */
export const PointsFactJournalPageSchema = z.strictObject({
  items: z.array(PointsFactJournalEntrySchema),
  /** Opaque cursor of the next (older) page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type PointsFactJournalPage = z.infer<typeof PointsFactJournalPageSchema>;
