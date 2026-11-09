import { z } from "zod";
import { PointsConditionSchema, type PointsCondition } from "./condition.js";
import { PointsFactTypeNameSchema } from "./fact-types.js";

// 025 attention-points engine — the ONE rule schema (amended EARS-25,
// EARS-35…39; 025-design production amendment B, G). Rules and settings are
// rows of the immutable `points_rule_versions`; their body is
// `PointsRuleBodySchema`, discriminated by `kind` (also a column, so a reader
// never parses a body to tell a rule from a setting):
//
//   rule    — trigger, condition, effect, limits, validity, active, stacking, label
//   setting — `setting.*` ids only, each with its own strict schema (EARS-39)
//   system  — `manual-correction` only (EARS-28)
//
// A rule id is any admin-chosen lowercase dotted slug outside the `setting.`
// namespace and the system id; the closed action enum of 0059 is gone (its
// compatibility copy is `./rules-v1.ts`). Catalog-dependent checks (condition
// type check, limit scope fields, Pul eligibility, `setting.effect.maxAmount`,
// kind continuity) run at publish in apps/api — this module is the shape.

const nonNegative = z.number().int().min(0);
const instant = z.iso.datetime({ offset: true }).nullable();
const slug = z
  .string()
  .max(128)
  .regex(
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/,
    "a lowercase dotted slug",
  );

/** The system rule a manual adjustment cites (EARS-28). */
export const POINTS_SYSTEM_RULE_ID = "manual-correction";

/** EARS-39 — the settings, each with its own strict schema and PRD default. */
const setting = (value: z.ZodNumber) =>
  z.strictObject({ kind: z.literal("setting"), value });
export const POINTS_SETTING_SCHEMAS = {
  /** EARS-9 — server-side presence share, whole percent of the item's duration. */
  "setting.presence.share": setting(z.number().int().min(1).max(100)),
  /** EARS-16 — open obligations per person, in Pul. */
  "setting.advance.cap": setting(nonNegative),
  /** EARS-18 — hours after an item's end before a still-held registration is a no-show. */
  "setting.noShow.window": setting(nonNegative),
  /** EARS-21 — concurrent open holds on limited-seat items per person. */
  "setting.reserve.limitedSeats.max": setting(nonNegative),
  /** EARS-23 — leaderboard score weight of Con. */
  "setting.leaderboard.conWeight": setting(nonNegative),
  /** EARS-23 — leaderboard score weight of Bre. */
  "setting.leaderboard.breWeight": setting(nonNegative),
  /** EARS-23 — rows of the specialty top. */
  "setting.leaderboard.top": setting(z.number().int().min(1)),
  /** EARS-23 — neighbours above and below the requester's own row. */
  "setting.leaderboard.neighbours": setting(nonNegative),
  /** Amended EARS-25 — no effect amount may exceed it. */
  "setting.effect.maxAmount": setting(nonNegative),
} as const;
export type PointsSettingId = keyof typeof POINTS_SETTING_SCHEMAS;
export const POINTS_SETTING_IDS = Object.keys(
  POINTS_SETTING_SCHEMAS,
) as PointsSettingId[];
export const PointsSettingIdSchema = z.enum(
  POINTS_SETTING_IDS as [PointsSettingId, ...PointsSettingId[]],
);
export function isPointsSettingId(value: string): value is PointsSettingId {
  return Object.hasOwn(POINTS_SETTING_SCHEMAS, value);
}
/** Every setting value is an integer (the condition type-checker's view). */
export const POINTS_SETTING_VALUE_TYPE = { type: "integer" } as const;

/** Amended EARS-25 — an admin rule id: a lowercase dotted slug, not a setting, not the system id. */
export const PointsRuleIdSchema = slug.refine(
  (id) => !id.startsWith("setting.") && id !== POINTS_SYSTEM_RULE_ID,
  "the setting. namespace and manual-correction are not rule ids",
);

/** EARS-36 — `<limit key>` of a `oncePer` dedupe key; defaults to the rule id. */
const limitKey = z
  .string()
  .max(128)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/);

/** A limit scope field: `subject`, `beneficiary`, `ref` or a declared attribute of every trigger type. */
const scopeField = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/);
const scope = z.array(scopeField).min(1).max(8);
const countOrSetting = (min: number) =>
  z.union([
    z.number().int().min(min),
    z.strictObject({ setting: PointsSettingIdSchema }),
  ]);

export const PointsRuleLimitSchema = z.union([
  z.strictObject({ oncePer: scope, key: limitKey.optional() }),
  z.strictObject({
    countPer: z.strictObject({
      scope,
      period: z.enum(["day", "week", "month"]),
      n: countOrSetting(1),
    }),
  }),
  z.strictObject({
    concurrentOpen: z.strictObject({
      n: countOrSetting(0),
      filter: z.strictObject({
        limitedSeats: z.boolean().optional(),
        itemKind: z.string().min(1).max(64).optional(),
      }),
    }),
  }),
  z.strictObject({ unlimited: z.literal(true) }),
]);
export type PointsRuleLimit = z.infer<typeof PointsRuleLimitSchema>;

const creditAmounts = z
  .strictObject({ pul: nonNegative, bre: nonNegative, con: nonNegative })
  .refine(
    (a) => a.pul + a.bre + a.con > 0,
    "a credit names a positive amount in at least one denomination",
  );

/** EARS-35 — exactly these effect kinds; `debit`, `reserve`, `settle`, `release` are Pul only. */
export const PointsRuleEffectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("credit"),
    beneficiary: z.union([
      z.literal("subject"),
      z.strictObject({ pred: z.string().min(1).max(128) }),
    ]),
    amounts: creditAmounts,
  }),
  z.strictObject({
    kind: z.literal("debit"),
    amounts: z.union([
      z.literal("price"),
      z.strictObject({ pul: z.number().int().min(1) }),
    ]),
  }),
  z.strictObject({ kind: z.literal("reserve"), allowAdvance: z.boolean() }),
  z.strictObject({ kind: z.literal("settle") }),
  z.strictObject({ kind: z.literal("release") }),
]);
export type PointsRuleEffect = z.infer<typeof PointsRuleEffectSchema>;
export type PointsRuleEffectKind = PointsRuleEffect["kind"];

/** A `kind: "rule"` body (025-design B). */
export const PointsRuleSchema = z
  .strictObject({
    kind: z.literal("rule"),
    /** Admin-facing text. */
    label: z.string().min(1).max(200),
    /** ≥1 registered fact type (EARS-32). */
    trigger: z.array(PointsFactTypeNameSchema).min(1).max(16),
    /** Absent = true (EARS-34). */
    condition: PointsConditionSchema.optional(),
    effect: PointsRuleEffectSchema,
    /** All must pass; ≥1, or exactly `[{ unlimited: true }]` (EARS-36). */
    limits: z.array(PointsRuleLimitSchema).min(1).max(8),
    /** EARS-37 — [validFrom, validUntil) on the fact's occurredAt. */
    validFrom: instant,
    validUntil: instant,
    active: z.boolean(),
    /** EARS-38. */
    stacking: z.strictObject({
      priority: z.number().int(),
      exclusiveGroup: limitKey.nullable(),
    }),
  })
  .superRefine((rule, ctx) => {
    if (new Set(rule.trigger).size !== rule.trigger.length) {
      ctx.addIssue({
        code: "custom",
        path: ["trigger"],
        message: "a trigger fact type is listed twice",
      });
    }
    if (
      rule.limits.some((limit) => "unlimited" in limit) &&
      rule.limits.length > 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limits"],
        message: "unlimited is the only limit when named",
      });
    }
    if (
      rule.validFrom !== null &&
      rule.validUntil !== null &&
      Date.parse(rule.validFrom) >= Date.parse(rule.validUntil)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil must be after validFrom",
      });
    }
  });
export type PointsRule = z.infer<typeof PointsRuleSchema>;

/** Any setting body (its per-id schema is `POINTS_SETTING_SCHEMAS[id]`). */
export const PointsSettingSchema = z.strictObject({
  kind: z.literal("setting"),
  value: z.number().int(),
});
export type PointsSetting = z.infer<typeof PointsSettingSchema>;

export const PointsSystemRuleSchema = z.strictObject({
  kind: z.literal("system"),
});

/** THE body of a `points_rule_versions` row (EARS-25 amended, EARS-39). */
export const PointsRuleBodySchema = z.discriminatedUnion("kind", [
  PointsRuleSchema,
  PointsSettingSchema,
  PointsSystemRuleSchema,
]);
export type PointsRuleBody = z.infer<typeof PointsRuleBodySchema>;
export type PointsRuleBodyKind = PointsRuleBody["kind"];

/**
 * The body schema a given id admits: its setting schema for a `setting.` id,
 * the system body for `manual-correction`, a rule for any admin slug. An
 * unknown `setting.` id or a malformed id refuses every body.
 */
export function parsePointsRuleBody(
  ruleId: string,
  body: unknown,
): z.ZodSafeParseResult<PointsRuleBody> {
  if (isPointsSettingId(ruleId)) {
    return POINTS_SETTING_SCHEMAS[ruleId].safeParse(body);
  }
  if (ruleId === POINTS_SYSTEM_RULE_ID) {
    return PointsSystemRuleSchema.safeParse(body);
  }
  const id = PointsRuleIdSchema.safeParse(ruleId);
  if (!id.success) {
    return z
      .never({ error: `${ruleId} is not a rule, setting or system id` })
      .safeParse(body);
  }
  return PointsRuleSchema.safeParse(body);
}

/**
 * The 0059 ids the engine retired (025-design G); a publish to one answers
 * `points-rule-retired` (422). Their v1 rows stay as stored, never selected.
 */
export const POINTS_RETIRED_RULE_IDS = [
  "cap.engagement",
  "cap.referral.monthly",
  "presence.share",
  "advance.cap",
  "reserve.limitedSeats.max",
  "noShow.window",
  "leaderboard.conWeight",
  "leaderboard.breWeight",
  "leaderboard.top",
  "leaderboard.neighbours",
] as const;

// ── EARS-44 seed (migration 0060) ──────────────────────────────────────────

const always = {
  validFrom: null,
  validUntil: null,
  active: true,
  stacking: { priority: 0, exclusiveGroup: null },
} as const;
const credit = (pul: number, bre: number, con: number) =>
  ({
    kind: "credit",
    beneficiary: "subject",
    amounts: { pul, bre, con },
  }) as const;
const oncePerSubjectRef: PointsRuleLimit[] = [{ oncePer: ["subject", "ref"] }];
const online: PointsCondition = { eq: [{ attr: "mode" }, "online"] };
const presenceReached: PointsCondition = {
  gte: [
    { attr: "presenceSharePercent" },
    { setting: "setting.presence.share" },
  ],
};
const referralQualifies: PointsCondition = {
  all: [
    { ne: [{ pred: "person.referrer" }, null] },
    { eq: [{ pred: "person.phoneVerified" }, true] },
    { gte: [{ pred: "person.completedLessons" }, 1] },
  ],
};
const oncePerRegistration: PointsRuleLimit[] = [
  { oncePer: ["subject", "registrationId"] },
];

/**
 * The rows migration 0060 inserts at the epoch (025-design G): version 2 of
 * each mapped 0059 accrual id, version 1 of each new rule and setting id, the
 * PRD amounts unchanged. points-seed-v2.e2e-spec pins the migration to this.
 */
export const POINTS_ENGINE_SEED: readonly {
  ruleId: string;
  version: number;
  body: PointsRuleBody;
}[] = [
  {
    ruleId: "accrual.registration",
    version: 2,
    body: {
      kind: "rule",
      label: "Registration grant",
      trigger: ["account.registered", "phone.verified"],
      condition: {
        all: [
          { eq: [{ pred: "person.registered" }, true] },
          { eq: [{ pred: "person.phoneVerified" }, true] },
        ],
      },
      effect: credit(20, 0, 0),
      limits: [{ oncePer: ["subject"], key: "welcome" }],
      ...always,
    },
  },
  {
    ruleId: "accrual.profile",
    version: 2,
    body: {
      kind: "rule",
      label: "Profile grant",
      trigger: ["profile.verified"],
      effect: credit(30, 2, 0),
      limits: [{ oncePer: ["subject"] }],
      ...always,
    },
  },
  {
    ruleId: "accrual.lesson",
    version: 2,
    body: {
      kind: "rule",
      label: "Lesson award, Pul part, online",
      trigger: ["lesson.completed"],
      condition: online,
      effect: credit(10, 0, 0),
      limits: [{ oncePer: ["subject", "ref"], key: "lesson.pul" }],
      ...always,
    },
  },
  {
    ruleId: "accrual.lesson.any-mode",
    version: 1,
    body: {
      kind: "rule",
      label: "Lesson award, Bre part, any mode",
      trigger: ["lesson.completed"],
      effect: credit(0, 1, 0),
      limits: [{ oncePer: ["subject", "ref"], key: "lesson" }],
      ...always,
    },
  },
  {
    ruleId: "accrual.module",
    version: 2,
    body: {
      kind: "rule",
      label: "Module award, Pul part, online",
      trigger: ["module.completed"],
      condition: online,
      effect: credit(20, 0, 0),
      limits: [{ oncePer: ["subject", "ref"], key: "module.pul" }],
      ...always,
    },
  },
  {
    ruleId: "accrual.module.any-mode",
    version: 1,
    body: {
      kind: "rule",
      label: "Module award, Bre and Con part, any mode",
      trigger: ["module.completed"],
      effect: credit(0, 3, 1),
      limits: [{ oncePer: ["subject", "ref"], key: "module" }],
      ...always,
    },
  },
  {
    ruleId: "accrual.participation",
    version: 2,
    body: {
      kind: "rule",
      label: "Participation award",
      trigger: ["attendance.confirmed"],
      condition: presenceReached,
      effect: credit(0, 2, 1),
      limits: oncePerSubjectRef,
      ...always,
    },
  },
  {
    ruleId: "accrual.question",
    version: 2,
    body: {
      kind: "rule",
      label: "Engagement award, question to the speaker",
      trigger: ["event.question-asked"],
      effect: credit(0, 1, 0),
      limits: oncePerSubjectRef,
      ...always,
    },
  },
  {
    ruleId: "accrual.rating",
    version: 2,
    body: {
      kind: "rule",
      label: "Engagement award, item rating",
      trigger: ["event.rated"],
      effect: credit(0, 1, 0),
      limits: oncePerSubjectRef,
      ...always,
    },
  },
  {
    ruleId: "accrual.interactive",
    version: 2,
    body: {
      kind: "rule",
      label: "Engagement award, interactive answer",
      trigger: ["event.interactive-answered"],
      effect: credit(0, 1, 0),
      limits: oncePerSubjectRef,
      ...always,
    },
  },
  {
    ruleId: "accrual.referral-inviter",
    version: 2,
    body: {
      kind: "rule",
      label: "Referral award, inviter",
      trigger: ["phone.verified", "lesson.completed"],
      condition: referralQualifies,
      effect: {
        kind: "credit",
        beneficiary: { pred: "person.referrer" },
        amounts: { pul: 30, bre: 2, con: 0 },
      },
      limits: [
        { oncePer: ["beneficiary", "subject"] },
        { countPer: { scope: ["beneficiary"], period: "month", n: 5 } },
      ],
      ...always,
    },
  },
  {
    ruleId: "accrual.referral-invitee",
    version: 2,
    body: {
      kind: "rule",
      label: "Referral award, invitee",
      trigger: ["phone.verified", "lesson.completed"],
      condition: referralQualifies,
      effect: credit(30, 0, 0),
      limits: [{ oncePer: ["subject"] }],
      ...always,
    },
  },
  {
    ruleId: "accrual.starter-bonus",
    version: 1,
    body: {
      kind: "rule",
      label: "Starter bonus for doctors registered before the engine",
      trigger: ["person.starter-bonus-eligible"],
      effect: credit(20, 0, 0),
      limits: [{ oncePer: ["subject"], key: "welcome" }],
      ...always,
    },
  },
  {
    ruleId: "spend.reserve",
    version: 1,
    body: {
      kind: "rule",
      label: "Reserve the price of a registration",
      trigger: ["registration.created"],
      effect: { kind: "reserve", allowAdvance: true },
      limits: [
        { oncePer: ["subject", "registrationId"] },
        {
          concurrentOpen: {
            n: { setting: "setting.reserve.limitedSeats.max" },
            filter: { limitedSeats: true },
          },
        },
      ],
      ...always,
    },
  },
  {
    ruleId: "spend.settle",
    version: 1,
    body: {
      kind: "rule",
      label: "Settle the hold on attendance",
      trigger: ["attendance.confirmed"],
      condition: presenceReached,
      effect: { kind: "settle" },
      limits: oncePerRegistration,
      ...always,
    },
  },
  {
    ruleId: "spend.release",
    version: 1,
    body: {
      kind: "rule",
      label: "Release the hold of a cancelled, voided or no-show registration",
      trigger: [
        "registration.cancelled",
        "registration.voided",
        "registration.no-show",
      ],
      effect: { kind: "release" },
      limits: oncePerRegistration,
      ...always,
    },
  },
  {
    ruleId: "spend.debit",
    version: 1,
    body: {
      kind: "rule",
      label: "Debit the price of immediate access",
      trigger: ["item.access-requested"],
      effect: { kind: "debit", amounts: "price" },
      limits: oncePerSubjectRef,
      ...always,
    },
  },
  ...(
    [
      ["setting.presence.share", 30],
      ["setting.advance.cap", 150],
      ["setting.noShow.window", 24],
      ["setting.reserve.limitedSeats.max", 3],
      ["setting.leaderboard.conWeight", 2],
      ["setting.leaderboard.breWeight", 1],
      ["setting.leaderboard.top", 10],
      ["setting.leaderboard.neighbours", 5],
      ["setting.effect.maxAmount", 500],
    ] as const
  ).map(([ruleId, value]) => ({
    ruleId,
    version: 1,
    body: { kind: "setting" as const, value },
  })),
];

/** The fact types a body triggers on — the `trigger_fact_types` column. */
export function pointsRuleTriggerFactTypes(body: PointsRuleBody): string[] {
  return body.kind === "rule" ? [...body.trigger] : [];
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

/**
 * EARS-25 — `POST /v1/admin/points/rules/:ruleId/versions` body. Phase 2 of
 * #3838 types `parameters` as {@link PointsRuleBodySchema}; until then the
 * 0059 route validates it against `./rules-v1.ts`.
 */
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
