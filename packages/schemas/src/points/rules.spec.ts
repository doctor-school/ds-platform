import { describe, expect, it } from "vitest";
import { POINTS_FACT_TYPES } from "./fact-types.js";
import {
  isPointsSettingId,
  parsePointsRuleBody,
  POINTS_ENGINE_SEED,
  POINTS_RETIRED_RULE_IDS,
  POINTS_SETTING_IDS,
  POINTS_SETTING_SCHEMAS,
  PointsRuleBodySchema,
  PointsRuleIdSchema,
  PointsRuleSchema,
  type PointsRule,
} from "./rules.js";

function rule(overrides: Partial<PointsRule> = {}): PointsRule {
  return {
    kind: "rule",
    label: "Lesson award, Pul part, online",
    trigger: ["lesson.completed"],
    condition: { eq: [{ attr: "mode" }, "online"] },
    effect: {
      kind: "credit",
      beneficiary: "subject",
      amounts: { pul: 10, bre: 0, con: 0 },
    },
    limits: [{ oncePer: ["subject", "ref"], key: "lesson.pul" }],
    validFrom: null,
    validUntil: null,
    active: true,
    stacking: { priority: 0, exclusiveGroup: null },
    ...overrides,
  };
}

describe("025 one rule schema (EARS-25 amended, EARS-39)", () => {
  it("025 EARS-25: a rule of the design B shape parses; the union discriminates on kind", () => {
    expect(PointsRuleSchema.parse(rule())).toEqual(rule());
    expect(PointsRuleBodySchema.parse(rule()).kind).toBe("rule");
    expect(
      PointsRuleBodySchema.parse({ kind: "setting", value: 30 }).kind,
    ).toBe("setting");
    expect(PointsRuleBodySchema.parse({ kind: "system" }).kind).toBe("system");
  });

  it("025 EARS-25: unknown fields, unregistered triggers and an empty limit list are refused with a path", () => {
    const extra = PointsRuleSchema.safeParse({ ...rule(), sponsorId: "x" });
    expect(extra.success).toBe(false);
    const trigger = PointsRuleSchema.safeParse(
      rule({ trigger: ["lesson.watched" as never] }),
    );
    expect(trigger.error?.issues[0]?.path).toEqual(["trigger", 0]);
    const limits = PointsRuleSchema.safeParse(rule({ limits: [] }));
    expect(limits.error?.issues[0]?.path).toEqual(["limits"]);
  });

  it("025 EARS-36: limit kinds oncePer (shared key), countPer, concurrentOpen and explicit unlimited", () => {
    for (const limits of [
      [{ oncePer: ["subject"], key: "welcome" }],
      [
        { oncePer: ["beneficiary", "subject"] },
        {
          countPer: { scope: ["beneficiary"], period: "month", n: 5 },
        },
      ],
      [
        {
          concurrentOpen: {
            n: { setting: "setting.reserve.limitedSeats.max" },
            filter: { limitedSeats: true },
          },
        },
      ],
      [{ unlimited: true }],
    ] as PointsRule["limits"][]) {
      expect(PointsRuleSchema.safeParse(rule({ limits })).success).toBe(true);
    }
    expect(
      PointsRuleSchema.safeParse(
        rule({ limits: [{ unlimited: true }, { oncePer: ["subject"] }] }),
      ).success,
    ).toBe(false);
    expect(
      PointsRuleSchema.safeParse(
        rule({
          limits: [
            { countPer: { scope: ["subject"], period: "year" as never, n: 1 } },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("025 EARS-35: exactly the effect kinds credit, debit, reserve, settle, release; debit is Pul only", () => {
    for (const effect of [
      {
        kind: "credit",
        beneficiary: { pred: "person.referrer" },
        amounts: { pul: 30, bre: 2, con: 0 },
      },
      { kind: "debit", amounts: "price" },
      { kind: "debit", amounts: { pul: 50 } },
      { kind: "reserve", allowAdvance: true },
      { kind: "settle" },
      { kind: "release" },
    ] as PointsRule["effect"][]) {
      expect(PointsRuleSchema.safeParse(rule({ effect })).success).toBe(true);
    }
    for (const effect of [
      { kind: "debit", amounts: { pul: 5, bre: 1 } },
      {
        kind: "credit",
        beneficiary: "subject",
        amounts: { pul: -1, bre: 0, con: 0 },
      },
      {
        kind: "credit",
        beneficiary: "subject",
        amounts: { pul: 0, bre: 0, con: 0 },
      },
      { kind: "convert" },
    ]) {
      expect(
        PointsRuleSchema.safeParse(rule({ effect: effect as never })).success,
        JSON.stringify(effect),
      ).toBe(false);
    }
  });

  it("025 EARS-37: a validity window must open before it closes", () => {
    expect(
      PointsRuleSchema.safeParse(
        rule({
          validFrom: "2026-12-01T00:00:00+03:00",
          validUntil: "2026-12-31T00:00:00+03:00",
        }),
      ).success,
    ).toBe(true);
    const bad = PointsRuleSchema.safeParse(
      rule({
        validFrom: "2026-12-31T00:00:00+03:00",
        validUntil: "2026-12-01T00:00:00+03:00",
      }),
    );
    expect(bad.error?.issues[0]?.path).toEqual(["validUntil"]);
  });

  it("025 EARS-39: every setting has its own strict schema and its seeded default", () => {
    expect([...POINTS_SETTING_IDS].sort()).toEqual(
      [
        "setting.presence.share",
        "setting.advance.cap",
        "setting.noShow.window",
        "setting.reserve.limitedSeats.max",
        "setting.leaderboard.conWeight",
        "setting.leaderboard.breWeight",
        "setting.leaderboard.top",
        "setting.leaderboard.neighbours",
        "setting.effect.maxAmount",
      ].sort(),
    );
    expect(
      POINTS_SETTING_SCHEMAS["setting.presence.share"].safeParse({
        kind: "setting",
        value: 101,
      }).success,
    ).toBe(false);
    expect(
      POINTS_SETTING_SCHEMAS["setting.leaderboard.top"].safeParse({
        kind: "setting",
        value: 0,
      }).success,
    ).toBe(false);
    expect(isPointsSettingId("setting.presence.share")).toBe(true);
    expect(isPointsSettingId("presence.share")).toBe(false);
  });

  it("025 EARS-39: a setting id takes only its setting body, a rule id only a rule body; a setting is never triggered", () => {
    expect(
      parsePointsRuleBody("setting.presence.share", {
        kind: "setting",
        value: 30,
      }).success,
    ).toBe(true);
    expect(parsePointsRuleBody("setting.presence.share", rule()).success).toBe(
      false,
    );
    expect(
      parsePointsRuleBody("accrual.lesson", { kind: "setting", value: 30 })
        .success,
    ).toBe(false);
    expect(
      parsePointsRuleBody("manual-correction", { kind: "system" }).success,
    ).toBe(true);
    expect(
      parsePointsRuleBody("setting.unknown", { kind: "setting", value: 1 })
        .success,
    ).toBe(false);
  });

  it("025 EARS-25: any lowercase dotted slug is a rule id; setting namespace and manual-correction are not admin rule ids", () => {
    for (const id of [
      "accrual.lesson",
      "accrual.lesson.any-mode",
      "campaign.new-year-2027",
    ]) {
      expect(PointsRuleIdSchema.safeParse(id).success, id).toBe(true);
    }
    for (const id of [
      "Accrual.Lesson",
      "lesson",
      "setting.x",
      "manual-correction",
      "a..b",
    ]) {
      expect(PointsRuleIdSchema.safeParse(id).success, id).toBe(false);
    }
  });

  it("025 EARS-44: every seeded row parses by its id's schema and names no retired id", () => {
    for (const row of POINTS_ENGINE_SEED) {
      const parsed = parsePointsRuleBody(row.ruleId, row.body);
      expect(parsed.success, `${row.ruleId}: ${parsed.error?.message}`).toBe(
        true,
      );
      expect(POINTS_RETIRED_RULE_IDS).not.toContain(row.ruleId);
    }
    const ids = POINTS_ENGINE_SEED.map((row) => row.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of POINTS_SETTING_IDS) expect(ids).toContain(id);
  });

  it("025 EARS-44: the 0059 accrual ids are seeded as version 2, the new ids as version 1 (design G)", () => {
    const versions = Object.fromEntries(
      POINTS_ENGINE_SEED.map((row) => [row.ruleId, row.version]),
    );
    for (const id of [
      "accrual.registration",
      "accrual.profile",
      "accrual.lesson",
      "accrual.module",
      "accrual.participation",
      "accrual.question",
      "accrual.rating",
      "accrual.interactive",
      "accrual.referral-inviter",
      "accrual.referral-invitee",
    ]) {
      expect(versions[id], id).toBe(2);
    }
    for (const id of [
      "accrual.lesson.any-mode",
      "accrual.module.any-mode",
      "accrual.starter-bonus",
      "spend.reserve",
      "spend.settle",
      "spend.release",
      "spend.debit",
    ]) {
      expect(versions[id], id).toBe(1);
    }
    expect(POINTS_RETIRED_RULE_IDS).toEqual([
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
    ]);
  });

  it("025 EARS-7/8: an online completion still totals the PRD award across the two parts", () => {
    const byId = Object.fromEntries(
      POINTS_ENGINE_SEED.map((row) => [row.ruleId, row.body]),
    ) as Record<string, PointsRule>;
    const credit = (id: string) => {
      const effect = byId[id]?.effect;
      return effect?.kind === "credit" ? effect.amounts : undefined;
    };
    expect(credit("accrual.lesson")).toEqual({ pul: 10, bre: 0, con: 0 });
    expect(credit("accrual.lesson.any-mode")).toEqual({
      pul: 0,
      bre: 1,
      con: 0,
    });
    expect(credit("accrual.module")).toEqual({ pul: 20, bre: 0, con: 0 });
    expect(credit("accrual.module.any-mode")).toEqual({
      pul: 0,
      bre: 3,
      con: 1,
    });
  });

  it("025 EARS-9/25: no seeded rule credits Pul on a fact type the catalog marks as not earning Pul", () => {
    for (const row of POINTS_ENGINE_SEED) {
      const body = row.body as PointsRule;
      if (body.kind !== "rule" || body.effect.kind !== "credit") continue;
      if (body.effect.amounts.pul === 0) continue;
      for (const type of body.trigger) {
        expect(
          POINTS_FACT_TYPES[type].earnsPul,
          `${row.ruleId} on ${type}`,
        ).toBe(true);
      }
    }
  });
});
