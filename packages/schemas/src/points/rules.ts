import { z } from "zod";

// 025 attention-points engine — the rule book (025-design §6, EARS-25). Every
// default the PRD names is a parameter of a versioned rule, never a literal in
// engine code (025-requirements «Defaults in brackets are rule-version
// parameters»). Each `rule_id` has ONE strict zod parameter schema here; the
// seed migration (0059) inserts version 1 of every rule with the PRD defaults.
//
// EARS-12 / EARS-25 by construction: the action set is a closed enum; every
// schema is strict, so no field can carry a prescription, a sale, a sponsor or
// an arrival source; an accrual amount is a non-negative integer per
// denomination — there is no field for a penalty and none for a conversion
// between denominations (1 Con = 2 Bre is a read-side weight, below).

/**
 * The closed accrual action set (025-requirements Event Model, earn table of
 * 025-product). One accrual rule `accrual.<action>` per action. A podcast
 * outside its lesson earns nothing, so it is not an action at all.
 */
export const POINTS_ACCRUAL_ACTIONS = [
  "registration",
  "profile",
  "lesson",
  "module",
  "participation",
  "question",
  "rating",
  "interactive",
  "referral-inviter",
  "referral-invitee",
] as const;
export const PointsAccrualActionSchema = z.enum(POINTS_ACCRUAL_ACTIONS);

/**
 * The actions credited once per person (025-product «Earn rules»:
 * registration — once per person; profile — once). Every other action is
 * deduplicated per content item and its fact carries `contentRef` (EARS-4).
 */
export const POINTS_PER_PERSON_ACTIONS = [
  "registration",
  "profile",
] as const satisfies readonly (typeof POINTS_ACCRUAL_ACTIONS)[number][];
export type PointsAccrualAction = z.infer<typeof PointsAccrualActionSchema>;

const amount = z.number().int().min(0);
const positive = z.number().int().min(1);

/** `accrual.<action>` — the credited amount per denomination; a zero denomination posts no leg. */
export const PointsAccrualRuleParametersSchema = z.strictObject({
  pul: amount,
  bre: amount,
  con: amount,
});
export type PointsAccrualRuleParameters = z.infer<
  typeof PointsAccrualRuleParametersSchema
>;

/** The rule id of an action's accrual rule. */
export function accrualRuleId<A extends PointsAccrualAction>(
  action: A,
): `accrual.${A}` {
  return `accrual.${action}`;
}

/**
 * Every rule id with its parameter schema. `cap.engagement` is fixed at one
 * award per (person, event, action) by EARS-10 itself — the accrual dedupe key
 * `<personId>:<eventRef>:<action>` enforces it — so its schema admits only 1.
 * `manual-correction` is the rule identity a manual adjustment cites (EARS-28)
 * and has no parameters.
 */
export const POINTS_RULE_PARAMETER_SCHEMAS = {
  ...(Object.fromEntries(
    POINTS_ACCRUAL_ACTIONS.map((action) => [
      accrualRuleId(action),
      PointsAccrualRuleParametersSchema,
    ]),
  ) as Record<
    `accrual.${PointsAccrualAction}`,
    typeof PointsAccrualRuleParametersSchema
  >),
  /** EARS-10 — engagement awards per (person, event, action). */
  "cap.engagement": z.strictObject({ perEventAndAction: z.literal(1) }),
  /** EARS-11 — inviter awards per calendar month (Europe/Moscow). */
  "cap.referral.monthly": z.strictObject({ perCalendarMonth: amount }),
  /** EARS-9 — the server-side presence share, in whole percent of the event's duration. */
  "presence.share": z.strictObject({
    percent: z.number().int().min(1).max(100),
  }),
  /** EARS-16 — open obligations per person, in Pul. */
  "advance.cap": z.strictObject({ pul: amount }),
  /** EARS-21 — concurrent open reserves on limited-seat events per person. */
  "reserve.limitedSeats.max": z.strictObject({ max: amount }),
  /** EARS-18 — hours after `EventEnded` before a still-reserved registration is a no-show. */
  "noShow.window": z.strictObject({ hours: amount }),
  /** EARS-23 — leaderboard score weight of Con (1 Con = 2 Bre). */
  "leaderboard.conWeight": z.strictObject({ weight: amount }),
  /** EARS-23 — leaderboard score weight of Bre. */
  "leaderboard.breWeight": z.strictObject({ weight: amount }),
  /** EARS-23 — rows of the specialty top. */
  "leaderboard.top": z.strictObject({ size: positive }),
  /** EARS-23 — neighbours above and below the requester's own row. */
  "leaderboard.neighbours": z.strictObject({ size: amount }),
  /** EARS-28 — the rule a manual adjustment cites; no parameters. */
  "manual-correction": z.strictObject({}),
} as const;

export type PointsRuleId = keyof typeof POINTS_RULE_PARAMETER_SCHEMAS;
export const POINTS_RULE_IDS = Object.keys(
  POINTS_RULE_PARAMETER_SCHEMAS,
) as PointsRuleId[];
export const PointsRuleIdSchema = z.enum(
  POINTS_RULE_IDS as [PointsRuleId, ...PointsRuleId[]],
);

/** The parameters of a rule, typed by its id. */
export type PointsRuleParameters<R extends PointsRuleId> = z.infer<
  (typeof POINTS_RULE_PARAMETER_SCHEMAS)[R]
>;

export function isPointsRuleId(value: string): value is PointsRuleId {
  return Object.hasOwn(POINTS_RULE_PARAMETER_SCHEMAS, value);
}

/**
 * Version 1 of every rule — the PRD defaults (025-product «Earn rules»,
 * «Spending, gating and the advance», «Leaderboard»). The seed migration 0059
 * inserts exactly these rows; a test pins the two together.
 */
export const POINTS_RULE_DEFAULTS: {
  readonly [R in PointsRuleId]: PointsRuleParameters<R>;
} = {
  "accrual.registration": { pul: 20, bre: 0, con: 0 },
  "accrual.profile": { pul: 30, bre: 2, con: 0 },
  "accrual.lesson": { pul: 10, bre: 1, con: 0 },
  "accrual.module": { pul: 20, bre: 3, con: 1 },
  "accrual.participation": { pul: 0, bre: 2, con: 1 },
  "accrual.question": { pul: 0, bre: 1, con: 0 },
  "accrual.rating": { pul: 0, bre: 1, con: 0 },
  "accrual.interactive": { pul: 0, bre: 1, con: 0 },
  "accrual.referral-inviter": { pul: 30, bre: 2, con: 0 },
  "accrual.referral-invitee": { pul: 30, bre: 0, con: 0 },
  "cap.engagement": { perEventAndAction: 1 },
  "cap.referral.monthly": { perCalendarMonth: 5 },
  "presence.share": { percent: 30 },
  "advance.cap": { pul: 150 },
  "reserve.limitedSeats.max": { max: 3 },
  "noShow.window": { hours: 24 },
  "leaderboard.conWeight": { weight: 2 },
  "leaderboard.breWeight": { weight: 1 },
  "leaderboard.top": { size: 10 },
  "leaderboard.neighbours": { size: 5 },
  "manual-correction": {},
};

/**
 * EARS-3 — an accrual-source fact as a producer hands it to the intake
 * (Event Model `AccrueFromFact`). `contentRef` names the content item the
 * action is about — the lesson, the module, the event (participation,
 * question, rating, interactive reaction), or the counterpart person of a
 * referral — and is REQUIRED for those actions (EARS-4): without it the dedupe
 * key would collapse to `<personId>::<action>` and a second lesson would read
 * as a duplicate of the first. Only a once-per-person action
 * ({@link POINTS_PER_PERSON_ACTIONS}: registration, profile) may omit it. There is deliberately no
 * field for a prescription, a sale, a sponsor or an arrival source that a rule
 * could read: an arrival link is ATTRIBUTION only, written to the postings and
 * read by no rule.
 */
export const PointsAccrualFactSchema = z
  .strictObject({
    eventId: z.string().min(1).max(256),
    personId: z.uuid(),
    action: PointsAccrualActionSchema,
    contentRef: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[^:]+$/, "a content ref carries no ':'")
      .optional(),
    occurredAt: z.coerce.date(),
    projectId: z.uuid().optional(),
    output: z
      .strictObject({
        type: z.string().min(1).max(128),
        id: z.uuid(),
      })
      .optional(),
    attribution: z
      .strictObject({
        organisationId: z.uuid().optional(),
        memberId: z.uuid().optional(),
      })
      .optional(),
  })
  .superRefine((fact, ctx) => {
    if (
      fact.contentRef === undefined &&
      !(POINTS_PER_PERSON_ACTIONS as readonly string[]).includes(fact.action)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contentRef"],
        message: `a ${fact.action} fact names its content item (contentRef)`,
      });
    }
  });
export type PointsAccrualFact = z.infer<typeof PointsAccrualFactSchema>;

/** The PRD dedupe key `<personId>:<contentRef>:<action>` (EARS-4); empty content segment for a once-per-person action. */
export function accrualDedupeKey(fact: {
  personId: string;
  contentRef?: string | undefined;
  action: PointsAccrualAction;
}): string {
  return `${fact.personId}:${fact.contentRef ?? ""}:${fact.action}`;
}

/** EARS-3 — `PointsCredited { personId, eventId, postings }`, the only source of a credited amount. */
export const PointsCreditedEventSchema = z.strictObject({
  personId: z.uuid(),
  eventId: z.string(),
  postings: z.array(
    z.strictObject({
      denomination: z.enum(["pul", "bre", "con"]),
      amount: z.number().int().positive(),
    }),
  ),
});
export type PointsCreditedEvent = z.infer<typeof PointsCreditedEventSchema>;

/** EARS-25 — `POST /v1/admin/points/rules/:ruleId/versions` body; `parameters` is validated against the rule's own schema. */
export const PublishPointsRuleVersionRequestSchema = z.strictObject({
  parameters: z.record(z.string(), z.unknown()),
  /** ISO-8601; absent = now. Never earlier than now. */
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
});
export type PublishPointsRuleVersionRequest = z.infer<
  typeof PublishPointsRuleVersionRequestSchema
>;

/** EARS-25 — a stored, immutable rule version. */
export const PointsRuleVersionSchema = z.strictObject({
  ruleId: z.string(),
  version: z.number().int().positive(),
  parameters: z.record(z.string(), z.unknown()),
  effectiveFrom: z.string(),
  /** The publishing admin's user id; null for a version the platform seeded. */
  publishedBy: z.uuid().nullable(),
  createdAt: z.string(),
});
export type PointsRuleVersion = z.infer<typeof PointsRuleVersionSchema>;
