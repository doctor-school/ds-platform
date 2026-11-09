import { describe, expect, it } from "vitest";
import {
  findForbiddenVocabulary,
  getPointsFactType,
  isPointsFactType,
  POINTS_FACT_TYPES,
  POINTS_PREDICATES,
  pointsFactAttributesSchema,
  type PointsFactTypeEntry,
} from "./fact-types.js";

describe("025 fact-type catalog", () => {
  it("025 EARS-32: every catalog entry and predicate is free of forbidden vocabulary", () => {
    expect(
      findForbiddenVocabulary({
        factTypes: POINTS_FACT_TYPES,
        predicates: POINTS_PREDICATES,
      }),
    ).toEqual([]);
  });

  it.each([
    ["sponsorId"],
    ["organisationId"],
    ["organizationId"],
    ["arrivalSource"],
    ["medRepId"],
    ["partnerChannel"],
    ["prescriptionCount"],
    ["saleAmount"],
  ])(
    "025 EARS-32: a planted %s attribute fails the vocabulary check",
    (name) => {
      const planted: PointsFactTypeEntry = {
        type: "lesson.completed",
        refKind: "lesson",
        earnsPul: true,
        attributes: { [name]: { type: "string" } },
      };
      const found = findForbiddenVocabulary({
        factTypes: { ...POINTS_FACT_TYPES, "lesson.completed": planted },
        predicates: POINTS_PREDICATES,
      });
      expect(found).toEqual([
        expect.stringContaining(`lesson.completed.attributes.${name}`),
      ]);
    },
  );

  it("025 EARS-32: a planted sponsor predicate or fact type fails the vocabulary check", () => {
    const found = findForbiddenVocabulary({
      factTypes: {
        ...POINTS_FACT_TYPES,
        "sponsor.paid": {
          type: "sponsor.paid",
          refKind: "none",
          earnsPul: true,
          attributes: {},
        },
      },
      predicates: {
        ...POINTS_PREDICATES,
        "person.sponsorFunded": {
          name: "person.sponsorFunded",
          subject: "person",
          result: { type: "boolean" },
        },
      },
    });
    expect(found).toHaveLength(2);
  });

  it("025 EARS-32: the only arrival the vocabulary exposes is the referral link", () => {
    expect(POINTS_PREDICATES["person.referrer"].result).toEqual({
      type: "string",
      nullable: true,
    });
    const names = Object.values(POINTS_FACT_TYPES).flatMap((entry) =>
      Object.keys(entry.attributes),
    );
    expect(names.some((name) => /refer/i.test(name))).toBe(false);
  });

  it("025 EARS-32: fact types are stable dotted past-tense slugs keyed by themselves", () => {
    for (const [key, entry] of Object.entries(POINTS_FACT_TYPES)) {
      expect(entry.type).toBe(key);
      expect(key).toMatch(/^[a-z]+(-[a-z]+)*(\.[a-z]+(-[a-z]+)*)+$/);
    }
  });

  it("025 EARS-32: the clause-map fact types are registered with their ref kind and Pul eligibility", () => {
    const expected: Record<string, [string, boolean]> = {
      "account.registered": ["none", true],
      "phone.verified": ["none", true],
      "profile.verified": ["none", true],
      "lesson.completed": ["lesson", true],
      "module.completed": ["module", true],
      "attendance.confirmed": ["item", false],
      "event.question-asked": ["item", false],
      "event.rated": ["item", false],
      "event.interactive-answered": ["item", false],
      "referral.attributed": ["person", false],
      "registration.created": ["item", false],
      "registration.cancelled": ["item", false],
      "registration.voided": ["item", false],
      "registration.no-show": ["item", false],
      "item.access-requested": ["item", false],
      "person.starter-bonus-eligible": ["none", true],
    };
    for (const [type, [refKind, earnsPul]] of Object.entries(expected)) {
      expect(isPointsFactType(type), type).toBe(true);
      const entry = getPointsFactType(type);
      expect([entry?.refKind, entry?.earnsPul], type).toEqual([
        refKind,
        earnsPul,
      ]);
    }
    expect(isPointsFactType("lesson.watched")).toBe(false);
    expect(getPointsFactType("lesson.watched")).toBeUndefined();
  });

  it("025 EARS-32: an entry's attributes parse strictly by their declared types", () => {
    const lesson = pointsFactAttributesSchema(
      POINTS_FACT_TYPES["lesson.completed"],
    );
    expect(lesson.safeParse({ mode: "online" }).success).toBe(true);
    expect(lesson.safeParse({ mode: "podcast" }).success).toBe(false);
    expect(lesson.safeParse({}).success).toBe(false);
    expect(lesson.safeParse({ mode: "online", amount: 10 }).success).toBe(
      false,
    );

    const attendance = pointsFactAttributesSchema(
      POINTS_FACT_TYPES["attendance.confirmed"],
    );
    expect(
      attendance.safeParse({ presenceSharePercent: 30, registrationId: null })
        .success,
    ).toBe(true);
    expect(
      attendance.safeParse({ presenceSharePercent: 30.5, registrationId: null })
        .success,
    ).toBe(false);
    expect(
      attendance.safeParse({ presenceSharePercent: 101, registrationId: null })
        .success,
    ).toBe(false);

    const starter = pointsFactAttributesSchema(
      POINTS_FACT_TYPES["person.starter-bonus-eligible"],
    );
    expect(starter.safeParse({ runId: "not-a-uuid" }).success).toBe(false);
  });
});
