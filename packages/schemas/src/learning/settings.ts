import { z } from "zod";

// 024 — the learning rule model as data (024-design §3; EARS-3, EARS-5…EARS-9).
// The VALUES are data (layers and presets); only the names of the setting keys,
// the scope levels and the condition-type names are contract. The condition-type
// catalog's behaviour (evaluation, sentence) is code in `@ds/learning`.

/** EARS-5 — the layers, nearest last: platform → school → course → module → lesson → step. */
export const LEARNING_SCOPE_KINDS = [
  "platform",
  "school",
  "course",
  "module",
  "lesson",
  "step",
] as const;
export const LearningScopeKindSchema = z.enum(LEARNING_SCOPE_KINDS);
export type LearningScopeKind = z.infer<typeof LearningScopeKindSchema>;

/** EARS-2 — the element types this slice declares (#4011); #4013 adds the rest. */
export const LEARNING_ELEMENT_TYPES = ["video", "download", "test"] as const;
export const LearningElementTypeSchema = z.enum(LEARNING_ELEMENT_TYPES);
export type LearningElementType = z.infer<typeof LearningElementTypeSchema>;

/** EARS-3 — the condition-type names of the catalog. */
export const LEARNING_CONDITION_TYPES = [
  "viewed",
  "watched-at-least",
  "opened",
  "listened-at-least",
  "test-passed",
  "club-attended",
  "manual-mark",
  "all-steps-done",
  "lessons-done",
] as const;
export type LearningConditionType = (typeof LEARNING_CONDITION_TYPES)[number];

/** EARS-6 — the maximum depth of a completion-rule tree. */
export const LEARNING_RULE_MAX_DEPTH = 4;

/**
 * One condition node. `condition` is checked against the catalog by the
 * `@ds/learning` validator (an unknown name is a field error, EARS-3); the
 * optional parameters are the ones the catalog's types read.
 */
export const LearningConditionNodeSchema = z.strictObject({
  condition: z.string().min(1).max(64),
  /** `viewed` / `watched-at-least` / `opened` / `listened-at-least` — a step of the scope; the scope step when omitted. */
  step: z.uuid().optional(),
  /** `watched-at-least` / `listened-at-least` — whole percent. */
  percent: z.number().int().min(1).max(100).optional(),
  /** `test-passed` — `exit`, `entry` or a test step id of the scope. */
  test: z.string().min(1).max(64).optional(),
  /** `club-attended` — a module of the scope; the scope module when omitted. */
  module: z.uuid().optional(),
});
export type LearningConditionNode = z.infer<typeof LearningConditionNodeSchema>;

export type LearningRuleNode =
  | LearningConditionNode
  | { all: LearningRuleNode[] }
  | { any: LearningRuleNode[] }
  | { nOf: { n: number; of: LearningRuleNode[] } };

/** EARS-6 — `all` / `any` / `n-of { n }` over conditions; bounds are checked by the validator. */
export const LearningRuleNodeSchema: z.ZodType<LearningRuleNode> = z.lazy(() =>
  z.union([
    LearningConditionNodeSchema,
    z.strictObject({ all: z.array(LearningRuleNodeSchema).min(1).max(20) }),
    z.strictObject({ any: z.array(LearningRuleNodeSchema).min(1).max(20) }),
    z.strictObject({
      nOf: z.strictObject({
        n: z.number().int().min(1),
        of: z.array(LearningRuleNodeSchema).min(1).max(20),
      }),
    }),
  ]),
);

/** EARS-7 — unlock kinds; none refers to a price or a payment. */
export const LearningUnlockSchema = z.union([
  z.strictObject({ kind: z.literal("immediate") }),
  z.strictObject({ kind: z.literal("after-previous") }),
  z.strictObject({ kind: z.literal("from-date"), instant: z.iso.datetime() }),
  z.strictObject({ kind: z.literal("expression"), rule: LearningRuleNodeSchema }),
]);
export type LearningUnlock = z.infer<typeof LearningUnlockSchema>;

const percent = z.number().int().min(1).max(100);
const minutes = z.number().int().min(0).max(525_600);

/**
 * Every setting key and its value schema (024-design §3). A layer's `values` is
 * a partial map of these; the platform layer holds every key (EARS-5).
 */
export const LEARNING_SETTING_SCHEMAS = {
  "completion.step": LearningRuleNodeSchema,
  "completion.lesson": LearningRuleNodeSchema,
  "completion.module": LearningRuleNodeSchema,
  "completion.course": LearningRuleNodeSchema,
  "viewed.video.percent": percent,
  "viewed.podcast.percent": percent,
  unlock: LearningUnlockSchema,
  order: z.enum(["strict", "free"]),
  lockedVisibility: z.enum(["hidden", "locked"]),
  "test.threshold": z.number().int().min(0).max(100),
  "test.attempts": z.union([z.number().int().min(1).max(100), z.literal("unlimited")]),
  "test.pauseMin": minutes,
  "test.questions": z.union([z.number().int().min(1).max(200), z.literal("all")]),
  "test.exitRequired": z.boolean(),
  "test.entryRequired": z.boolean(),
  "test.entryCounts": z.boolean(),
  "testOut.allowed": z.boolean(),
  "testOut.pauseMin": minutes,
  "repeat.allowed": z.boolean(),
  "course.deliveryMode": z.enum(["online", "offline", "open"]),
  "course.moduleSize": z.number().int().min(1).max(50),
  "course.closingClub": z.boolean(),
  "course.clubInCompletion": z.boolean(),
} as const;

export type LearningSettingKey = keyof typeof LEARNING_SETTING_SCHEMAS;
export const LEARNING_SETTING_KEYS = Object.keys(
  LEARNING_SETTING_SCHEMAS,
) as LearningSettingKey[];
export type LearningSettings = {
  [K in LearningSettingKey]: z.infer<(typeof LEARNING_SETTING_SCHEMAS)[K]>;
};

/** A layer's or a preset's partial map of setting values. */
export const LearningSettingValuesSchema = z.strictObject(
  Object.fromEntries(
    LEARNING_SETTING_KEYS.map((k) => [k, LEARNING_SETTING_SCHEMAS[k].optional()]),
  ) as { [K in LearningSettingKey]: z.ZodOptional<(typeof LEARNING_SETTING_SCHEMAS)[K]> },
);
export type LearningSettingValues = Partial<LearningSettings>;

/** The platform layer: every key present (EARS-5). */
export const LearningPlatformValuesSchema = z.strictObject(LEARNING_SETTING_SCHEMAS);

/** EARS-5 — one resolved setting: value, the level it comes from, the preset that wrote it. */
export const LearningResolvedSettingSchema = z.strictObject({
  key: z.enum(LEARNING_SETTING_KEYS as [LearningSettingKey, ...LearningSettingKey[]]),
  value: z.unknown(),
  level: LearningScopeKindSchema,
  preset: z.string().nullable(),
});
export type LearningResolvedSetting = z.infer<typeof LearningResolvedSettingSchema>;
