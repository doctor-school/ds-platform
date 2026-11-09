import { describe, expect, it } from "vitest";
import type { PointsRule } from "@ds/schemas";
import { checkRuleBody } from "./publish-check.js";

const base: PointsRule = {
  kind: "rule",
  label: "test",
  trigger: ["lesson.completed"],
  effect: {
    kind: "credit",
    beneficiary: "subject",
    amounts: { pul: 10, bre: 0, con: 0 },
  },
  limits: [{ oncePer: ["subject", "ref"] }],
  validFrom: null,
  validUntil: null,
  active: true,
  stacking: { priority: 0, exclusiveGroup: null },
};
const check = (overrides: Partial<PointsRule>, maxAmount = 500) =>
  checkRuleBody({ ...base, ...overrides } as PointsRule, { maxAmount });
const paths = (overrides: Partial<PointsRule>, maxAmount?: number) =>
  check(overrides, maxAmount).map((i) => i.path);

describe("025 rule publish catalog checks", () => {
  it("025 EARS-25: a well-formed rule over the catalog passes", () => {
    expect(check({})).toEqual([]);
    expect(
      check({
        condition: { eq: [{ attr: "mode" }, "online"] },
        limits: [
          { oncePer: ["subject", "ref"], key: "lesson.pul" },
          { countPer: { scope: ["subject", "mode"], period: "month", n: 5 } },
        ],
      }),
    ).toEqual([]);
  });

  it("025 EARS-34: an unknown or ill-typed condition operand is refused with a condition.-prefixed path", () => {
    expect(paths({ condition: { eq: [{ attr: "sponsorId" }, "x"] } })).toEqual([
      "condition.eq.0.attr",
    ]);
    expect(paths({ condition: { gt: [{ attr: "mode" }, 1] } })[0]).toMatch(
      /^condition\.gt/,
    );
    expect(
      paths({ condition: { eq: [{ pred: "person.salesTotal" }, 1] } })[0],
    ).toMatch(/^condition\.eq\.0/);
  });

  it("025 EARS-25: no Pul credit on a fact type the catalog marks as not earning Pul (EARS-9)", () => {
    expect(paths({ trigger: ["attendance.confirmed"], limits: [{ oncePer: ["subject", "ref"] }] })).toEqual([
      "effect.amounts.pul",
    ]);
  });

  it("025 EARS-25: no amount above setting.effect.maxAmount", () => {
    expect(paths({}, 5)).toEqual(["effect.amounts.pul"]);
    expect(paths({ effect: { kind: "debit", amounts: { pul: 6 } } }, 5)).toEqual([
      "effect.amounts.pul",
    ]);
  });

  it("025 EARS-35: a beneficiary predicate must name a person", () => {
    expect(
      paths({
        effect: {
          kind: "credit",
          beneficiary: { pred: "item.price" },
          amounts: { pul: 1, bre: 0, con: 0 },
        },
      }),
    ).toEqual(["effect.beneficiary.pred"]);
    expect(
      paths({
        effect: {
          kind: "credit",
          beneficiary: { pred: "person.referrer" },
          amounts: { pul: 1, bre: 0, con: 0 },
        },
      }),
    ).toEqual([]);
  });

  it("025 EARS-36: every limit scope field exists on every trigger fact type; one oncePer per rule", () => {
    expect(
      paths({
        trigger: ["lesson.completed", "phone.verified"],
        limits: [{ oncePer: ["subject", "ref"] }],
      }),
    ).toEqual(["limits.0.oncePer.1"]);
    expect(
      paths({ limits: [{ countPer: { scope: ["registrationId"], period: "day", n: 1 } }] }),
    ).toEqual(["limits.0.countPer.scope.0"]);
    expect(
      paths({ limits: [{ oncePer: ["subject"] }, { oncePer: ["subject", "ref"] }] }),
    ).toEqual(["limits.1.oncePer"]);
  });

  it("025 EARS-35: reserve, settle, release, a price-list debit and concurrentOpen wait for the spend slice (#3810)", () => {
    const spend = (effect: PointsRule["effect"]) =>
      paths({ trigger: ["registration.created"], effect, limits: [{ unlimited: true }] });
    expect(spend({ kind: "reserve", allowAdvance: true })).toEqual(["effect.kind"]);
    expect(spend({ kind: "settle" })).toEqual(["effect.kind"]);
    expect(spend({ kind: "release" })).toEqual(["effect.kind"]);
    expect(spend({ kind: "debit", amounts: "price" })).toEqual(["effect.amounts"]);
    expect(
      paths({
        limits: [{ concurrentOpen: { n: 1, filter: { limitedSeats: true } } }],
      }),
    ).toEqual(["limits.0.concurrentOpen"]);
  });
});
