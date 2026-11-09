import { describe, expect, it } from "vitest";
import { moscowPeriod } from "./period.js";

describe("025 countPer period (Europe/Moscow)", () => {
  it("025 EARS-36: a month starts at Moscow midnight of the 1st — 21:00 UTC of the previous day", () => {
    // 2026-11-30T21:30Z is already 2026-12-01 00:30 in Moscow.
    const december = moscowPeriod("month", new Date("2026-11-30T21:30:00Z"));
    expect(december.start.toISOString()).toBe("2026-11-30T21:00:00.000Z");
    expect(december.end.toISOString()).toBe("2026-12-31T21:00:00.000Z");
    // One minute earlier, 20:59Z, is still November in Moscow.
    const november = moscowPeriod("month", new Date("2026-11-30T20:59:00Z"));
    expect(november.start.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(november.end.toISOString()).toBe("2026-11-30T21:00:00.000Z");
  });

  it("025 EARS-36: a day is the Moscow calendar day and a week starts on Monday", () => {
    const day = moscowPeriod("day", new Date("2026-11-09T22:00:00Z"));
    expect(day.start.toISOString()).toBe("2026-11-09T21:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-11-10T21:00:00.000Z");
    // 2026-11-11 (Wednesday, Moscow) → week of Monday 2026-11-09.
    const week = moscowPeriod("week", new Date("2026-11-11T12:00:00Z"));
    expect(week.start.toISOString()).toBe("2026-11-08T21:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-11-15T21:00:00.000Z");
    // Sunday 23:30 Moscow still belongs to that week.
    const sunday = moscowPeriod("week", new Date("2026-11-15T20:30:00Z"));
    expect(sunday.start.toISOString()).toBe("2026-11-08T21:00:00.000Z");
  });
});
