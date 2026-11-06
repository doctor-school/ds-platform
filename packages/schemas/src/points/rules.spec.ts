import { describe, expect, it } from "vitest";
import {
  accrualDedupeKey,
  POINTS_ACCRUAL_ACTIONS,
  POINTS_RULE_DEFAULTS,
  POINTS_RULE_IDS,
  POINTS_RULE_PARAMETER_SCHEMAS,
  PointsAccrualFactSchema,
} from "./rules.js";

describe("025 rule book schemas", () => {
  it("025 EARS-25: every rule id has a strict schema and a PRD default that satisfies it", () => {
    expect(POINTS_RULE_IDS).toHaveLength(
      Object.keys(POINTS_RULE_DEFAULTS).length,
    );
    for (const ruleId of POINTS_RULE_IDS) {
      const schema = POINTS_RULE_PARAMETER_SCHEMAS[ruleId];
      expect(
        schema.safeParse(POINTS_RULE_DEFAULTS[ruleId]).success,
        ruleId,
      ).toBe(true);
    }
    for (const action of POINTS_ACCRUAL_ACTIONS) {
      expect(POINTS_RULE_IDS).toContain(`accrual.${action}`);
    }
  });

  it("025 EARS-25: the PRD earn table is version 1 of the accrual rules", () => {
    expect(POINTS_RULE_DEFAULTS["accrual.registration"]).toEqual({
      pul: 20,
      bre: 0,
      con: 0,
    });
    expect(POINTS_RULE_DEFAULTS["accrual.lesson"]).toEqual({
      pul: 10,
      bre: 1,
      con: 0,
    });
    expect(POINTS_RULE_DEFAULTS["accrual.module"]).toEqual({
      pul: 20,
      bre: 3,
      con: 1,
    });
    expect(POINTS_RULE_DEFAULTS["accrual.participation"].pul).toBe(0);
    expect(POINTS_RULE_DEFAULTS["advance.cap"]).toEqual({ pul: 150 });
    expect(POINTS_RULE_DEFAULTS["presence.share"]).toEqual({ percent: 30 });
    expect(POINTS_RULE_DEFAULTS["cap.referral.monthly"]).toEqual({
      perCalendarMonth: 5,
    });
  });

  it("025 EARS-12: an accrual rule cannot express a penalty, a conversion or a fractional amount", () => {
    const schema = POINTS_RULE_PARAMETER_SCHEMAS["accrual.lesson"];
    expect(schema.safeParse({ pul: -1, bre: 0, con: 0 }).success).toBe(false);
    expect(schema.safeParse({ pul: 0, bre: -1, con: 0 }).success).toBe(false);
    expect(schema.safeParse({ pul: 0, bre: 0, con: -1 }).success).toBe(false);
    expect(schema.safeParse({ pul: 1.5, bre: 0, con: 0 }).success).toBe(false);
    expect(
      schema.safeParse({ pul: 10, bre: 1, con: 0, conToBre: 2 }).success,
    ).toBe(false);
  });

  it("025 EARS-25: no rule schema accepts a prescription, sale, sponsor or arrival-source input", () => {
    for (const ruleId of POINTS_RULE_IDS) {
      for (const field of [
        "prescriptions",
        "sales",
        "sponsorId",
        "arrivalSource",
      ]) {
        const candidate = { ...POINTS_RULE_DEFAULTS[ruleId], [field]: 1 };
        expect(
          POINTS_RULE_PARAMETER_SCHEMAS[ruleId].safeParse(candidate).success,
          `${ruleId}.${field}`,
        ).toBe(false);
      }
    }
  });

  it("025 EARS-3: an accrual fact names only the closed action set and carries no rule input beyond it", () => {
    const base = {
      eventId: "e-1",
      personId: "00000000-0000-4000-8000-000000000001",
      action: "lesson",
      contentRef: "lesson-1",
      occurredAt: "2026-11-06T10:00:00Z",
    };
    expect(PointsAccrualFactSchema.safeParse(base).success).toBe(true);
    expect(
      PointsAccrualFactSchema.safeParse({ ...base, action: "prescription" })
        .success,
    ).toBe(false);
    expect(
      PointsAccrualFactSchema.safeParse({ ...base, sponsorId: "x" }).success,
    ).toBe(false);
    expect(
      accrualDedupeKey({ personId: "p", contentRef: "l", action: "lesson" }),
    ).toBe("p:l:lesson");
    expect(accrualDedupeKey({ personId: "p", action: "registration" })).toBe(
      "p::registration",
    );
  });

  it("025 EARS-4: a fact of a content-scoped action requires contentRef; a once-per-person action (registration, profile) forbids it", () => {
    const base = {
      eventId: "e-1",
      personId: "00000000-0000-4000-8000-000000000001",
      occurredAt: "2026-11-06T10:00:00Z",
    };
    const perPerson = ["registration", "profile"];
    for (const action of POINTS_ACCRUAL_ACTIONS) {
      const once = perPerson.includes(action);
      const withRef = PointsAccrualFactSchema.safeParse({
        ...base,
        action,
        contentRef: "item-1",
      });
      expect(withRef.success, action).toBe(!once);
      const withoutRef = PointsAccrualFactSchema.safeParse({ ...base, action });
      expect(withoutRef.success, action).toBe(once);
      for (const refused of [withRef, withoutRef]) {
        if (!refused.success) {
          expect(refused.error.issues[0]?.path).toEqual(["contentRef"]);
        }
      }
    }
  });
});
