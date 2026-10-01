import { describe, expect, it } from "vitest";

import {
  CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING,
  CONGRESS_INTAKE_DEFAULTS,
  CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING,
  CONGRESS_SUBMISSION_KIND_LABELS,
  CongressIntakeSettingsRequestSchema,
  type CongressIntakeSettingsRequest,
  instantToMskDay,
  isCongressKindIntakeOpen,
  lastDayOfClosingInstant,
  mskClosingInstantAfterLastDay,
  mskDayStartInstant,
} from "./congress-intake-settings.schema.js";

function body(
  patch: Partial<CongressIntakeSettingsRequest["kinds"]["oral"]> = {},
  top: Partial<CongressIntakeSettingsRequest> = {},
): CongressIntakeSettingsRequest {
  return {
    ...CONGRESS_INTAKE_DEFAULTS,
    ...top,
    kinds: {
      ...CONGRESS_INTAKE_DEFAULTS.kinds,
      oral: { ...CONGRESS_INTAKE_DEFAULTS.kinds.oral, ...patch },
    },
  };
}

function refusalCodes(input: unknown): unknown[] {
  const parsed = CongressIntakeSettingsRequestSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map(
    (i) => (i as { params?: { code?: string } }).params?.code ?? i.code,
  );
}

describe("046 congress intake settings — contract and day rules", () => {
  it("046 EARS-1: a kind's intake is open exactly from its opening instant up to, not including, its closing instant", () => {
    const opensAt = new Date("2026-10-31T21:00:00.000Z");
    const closesAt = new Date("2027-01-29T21:00:00.000Z");
    const w = { opensAt, closesAt };
    expect(isCongressKindIntakeOpen(w, new Date(opensAt.getTime() - 1))).toBe(
      false,
    );
    expect(isCongressKindIntakeOpen(w, opensAt)).toBe(true);
    expect(isCongressKindIntakeOpen(w, new Date(closesAt.getTime() - 1))).toBe(
      true,
    );
    expect(isCongressKindIntakeOpen(w, closesAt)).toBe(false);
    // An empty opening instant = not announced: never open.
    expect(isCongressKindIntakeOpen({ opensAt: null, closesAt }, opensAt)).toBe(
      false,
    );
  });

  it("046 EARS-2: the product defaults — abstracts 3, oral and poster unlimited, poster age 40, rule off, no dates", () => {
    expect(CONGRESS_INTAKE_DEFAULTS).toEqual({
      registrationUrl: null,
      firstAuthorCounts: false,
      kinds: {
        oral: {
          opensOn: null,
          lastDay: null,
          submitLimit: null,
          maxAgeYears: null,
        },
        poster: {
          opensOn: null,
          lastDay: null,
          submitLimit: null,
          maxAgeYears: 40,
        },
        abstract: {
          opensOn: null,
          lastDay: null,
          submitLimit: 3,
          maxAgeYears: null,
        },
      },
    });
    expect(
      CongressIntakeSettingsRequestSchema.safeParse(CONGRESS_INTAKE_DEFAULTS)
        .success,
    ).toBe(true);
  });

  it("046 EARS-2: refuses an opening day without a last day and a last day before the opening day", () => {
    expect(
      refusalCodes(body({ opensOn: "2026-11-01", lastDay: null })),
    ).toEqual([CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING]);
    expect(
      refusalCodes(body({ opensOn: "2026-11-02", lastDay: "2026-11-01" })),
    ).toEqual([CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING]);
    // A one-day window (last day = opening day) closes 24 h after it opens.
    expect(
      CongressIntakeSettingsRequestSchema.safeParse(
        body({ opensOn: "2026-11-01", lastDay: "2026-11-01" }),
      ).success,
    ).toBe(true);
    // A last day with no opening day = not announced yet: allowed.
    expect(
      CongressIntakeSettingsRequestSchema.safeParse(
        body({ opensOn: null, lastDay: "2027-01-29" }),
      ).success,
    ).toBe(true);
  });

  it("046 EARS-2: refuses a limit that is not a positive integer and an age limit outside 18…99", () => {
    for (const submitLimit of [0, -1, 1.5]) {
      expect(
        CongressIntakeSettingsRequestSchema.safeParse(body({ submitLimit }))
          .success,
      ).toBe(false);
    }
    for (const maxAgeYears of [17, 100, 40.5]) {
      expect(
        CongressIntakeSettingsRequestSchema.safeParse(body({ maxAgeYears }))
          .success,
      ).toBe(false);
    }
    for (const maxAgeYears of [18, 99]) {
      expect(
        CongressIntakeSettingsRequestSchema.safeParse(body({ maxAgeYears }))
          .success,
      ).toBe(true);
    }
    expect(
      CongressIntakeSettingsRequestSchema.safeParse(
        body({}, { registrationUrl: "javascript:alert(1)" }),
      ).success,
    ).toBe(false);
    expect(
      CongressIntakeSettingsRequestSchema.safeParse(
        body({}, { registrationUrl: "https://orthobio.ru/registration" }),
      ).success,
    ).toBe(true);
  });

  it("046 EARS-3: an opening day is 00:00 Moscow; a last day closes at 00:00 Moscow of the next day", () => {
    expect(mskDayStartInstant("2026-11-01").toISOString()).toBe(
      "2026-10-31T21:00:00.000Z",
    );
    expect(mskClosingInstantAfterLastDay("2027-01-29").toISOString()).toBe(
      "2027-01-29T21:00:00.000Z",
    );
    // Month and year boundaries.
    expect(mskClosingInstantAfterLastDay("2026-12-31").toISOString()).toBe(
      "2026-12-31T21:00:00.000Z",
    );
    // Open through 23:59:59 Moscow of the last day.
    const closes = mskClosingInstantAfterLastDay("2027-01-29");
    expect(instantToMskDay(new Date(closes.getTime() - 1000))).toBe(
      "2027-01-29",
    );
    expect(instantToMskDay(closes)).toBe("2027-01-30");
    // The read projection returns the day the administrator entered.
    expect(lastDayOfClosingInstant(closes)).toBe("2027-01-29");
    expect(instantToMskDay(mskDayStartInstant("2026-11-01"))).toBe(
      "2026-11-01",
    );
    expect(() => mskDayStartInstant("2026-02-30")).toThrow(RangeError);
  });
});

describe("046 kind labels", () => {
  it("EARS-14: every kind has the Russian name the section shows", () => {
    expect(CONGRESS_SUBMISSION_KIND_LABELS).toEqual({
      oral: "Устный доклад",
      poster: "Постерный доклад",
      abstract: "Тезисы",
    });
  });
});
