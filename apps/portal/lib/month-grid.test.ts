import { describe, expect, it } from "vitest";
import type { MonthBroadcastEntry } from "@ds/schemas";

import {
  buildMonthGrid,
  capDayEntries,
  currentMskMonth,
  formatMonthTitle,
  isMonthFuture,
  isMonthPast,
  monthShortLabels,
  mskDateParts,
  shiftMonth,
  weekdayShortLabels,
} from "./month-grid";

/**
 * 004 EARS-19 — the pure month-grid layout SSOT. Timezone-fold correctness
 * (МСК, EARS-12) and the Monday-first 7-column matrix are unit-verified here;
 * the rendered geometry (pills / dot-grid / agenda) is the Playwright fidelity
 * pin (`e2e/month-fidelity.spec.ts`). July 2026 is the canvas reference month
 * (June 30 is a Monday, so the grid opens with one leading filler cell, then
 * 1–31, then Aug 1–3 = exactly 5 rows — `webinars-month.dc.html`).
 */

const entry = (
  id: string,
  startsAt: string,
  state: MonthBroadcastEntry["state"] = "published",
): MonthBroadcastEntry => ({
  id: `00000000-0000-0000-0000-0000000000${id}`,
  slug: `event-${id}`,
  title: `Event ${id}`,
  school: `School ${id}`,
  startsAt,
  state,
});

// 13:00 МСК on 16 July 2026 (10:00 UTC) — "today" for the reference month.
const NOW = new Date("2026-07-16T10:00:00.000Z");

describe("currentMskMonth", () => {
  it("EARS-19: folds an instant to its МСК YYYY-MM month", () => {
    expect(currentMskMonth(NOW)).toBe("2026-07");
  });

  it("EARS-19: an instant late-evening UTC still reports the МСК day's month (UTC+3 roll)", () => {
    // 22:30 UTC on 31 Jan is 01:30 МСК on 1 Feb → February, not January.
    expect(currentMskMonth(new Date("2026-01-31T22:30:00.000Z"))).toBe(
      "2026-02",
    );
  });
});

describe("mskDateParts", () => {
  it("EARS-19: reports the МСК calendar date, not the UTC date", () => {
    expect(mskDateParts(new Date("2026-07-16T22:30:00.000Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 17, // 01:30 МСК next day
    });
  });
});

describe("buildMonthGrid — July 2026 (canvas reference)", () => {
  const grid = buildMonthGrid({
    month: "2026-07",
    now: NOW,
    entries: [
      entry("16", "2026-07-16T16:00:00.000Z", "live"), // 19:00 МСК, today, LIVE
      entry("17", "2026-07-16T17:30:00.000Z", "published"), // 20:30 МСК, today
      entry("01", "2026-07-01T15:00:00.000Z", "ended"), // past day
      entry("20", "2026-07-20T16:00:00.000Z", "published"), // future day
    ],
  });

  const flat = grid.weeks.flat();
  const cellFor = (day: number) => flat.find((c) => c.inMonth && c.day === day)!;

  it("EARS-19: lays out exactly 5 Monday-first weeks of 7 cells", () => {
    expect(grid.weeks).toHaveLength(5);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
  });

  it("EARS-19: opens with the June 29–30 leading filler, then July 1 in the Wednesday column", () => {
    // 1 July 2026 is a Wednesday (Monday-first index 2) → two leading fillers.
    expect(grid.weeks[0][0]).toMatchObject({ day: 29, inMonth: false });
    expect(grid.weeks[0][1]).toMatchObject({ day: 30, inMonth: false });
    expect(grid.weeks[0][2]).toMatchObject({ day: 1, inMonth: true });
  });

  it("EARS-19: closes with next-month trailing filler completing the last row", () => {
    const last = grid.weeks.at(-1)!;
    expect(last.at(-1)).toMatchObject({ inMonth: false });
    expect(grid.weeks.flat()).toHaveLength(35);
  });

  it("EARS-19: flags today (16 July) and reports todayDom", () => {
    expect(grid.todayDom).toBe(16);
    expect(cellFor(16)).toMatchObject({ isToday: true, isPast: false });
  });

  it("EARS-19: marks days before today as past, today/future as not past", () => {
    expect(cellFor(1).isPast).toBe(true);
    expect(cellFor(15).isPast).toBe(true);
    expect(cellFor(16).isPast).toBe(false);
    expect(cellFor(20).isPast).toBe(false);
  });

  it("EARS-19: marks Sat/Sun as weekend (4,5 Jul) and weekdays not", () => {
    expect(cellFor(4).isWeekend).toBe(true); // Saturday
    expect(cellFor(5).isWeekend).toBe(true); // Sunday
    expect(cellFor(6).isWeekend).toBe(false); // Monday
  });

  it("EARS-19: buckets entries onto their МСК day, preserving backend order", () => {
    expect(cellFor(16).entries.map((e) => e.slug)).toEqual([
      "event-16",
      "event-17",
    ]);
    expect(cellFor(20).entries).toHaveLength(1);
    expect(cellFor(2).entries).toHaveLength(0);
  });

  it("EARS-19: a live entry is discoverable on its day (red-pill source, EARS-9 parity)", () => {
    expect(cellFor(16).entries.some((e) => e.state === "live")).toBe(true);
  });

  it("EARS-19: a non-current month has no today marker", () => {
    const other = buildMonthGrid({ month: "2026-09", now: NOW, entries: [] });
    expect(other.todayDom).toBeNull();
    expect(other.weeks.flat().every((c) => !c.isToday)).toBe(true);
  });
});

describe("shiftMonth (EARS-17 — month paging, year-boundary safe)", () => {
  it("EARS-17: steps to the next month within a year", () => {
    expect(shiftMonth("2026-07", 1)).toBe("2026-08");
  });

  it("EARS-17: steps to the previous month within a year", () => {
    expect(shiftMonth("2026-07", -1)).toBe("2026-06");
  });

  it("EARS-17: rolls forward across the December→January year boundary", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("EARS-17: rolls back across the January→December year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("EARS-17: steps a whole year (±12) preserving the month number", () => {
    expect(shiftMonth("2026-07", 12)).toBe("2027-07");
    expect(shiftMonth("2026-07", -12)).toBe("2025-07");
  });

  it("EARS-17: always emits a zero-padded MONTH_PARAM-shaped value", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
    expect(shiftMonth("2026-02", -2)).toBe("2025-12");
  });
});

describe("isMonthPast (EARS-16 — picker muting, МСК)", () => {
  it("EARS-16: a month strictly before the current МСК month is past", () => {
    expect(isMonthPast("2026-06", NOW)).toBe(true);
    expect(isMonthPast("2025-12", NOW)).toBe(true);
  });

  it("EARS-16: the current МСК month is not past", () => {
    expect(isMonthPast("2026-07", NOW)).toBe(false);
  });

  it("EARS-16: a future month is not past", () => {
    expect(isMonthPast("2026-08", NOW)).toBe(false);
    expect(isMonthPast("2027-01", NOW)).toBe(false);
  });
});

describe("isMonthFuture (owner verdict #5 — return-from-future back link)", () => {
  it("a month strictly after the current МСК month is future", () => {
    expect(isMonthFuture("2026-08", NOW)).toBe(true);
    expect(isMonthFuture("2027-01", NOW)).toBe(true);
  });

  it("the current МСК month is NOT future (no back link)", () => {
    expect(isMonthFuture("2026-07", NOW)).toBe(false);
  });

  it("a past month is NOT future (no back link)", () => {
    expect(isMonthFuture("2026-06", NOW)).toBe(false);
    expect(isMonthFuture("2025-12", NOW)).toBe(false);
  });
});

describe("monthShortLabels (EARS-16 — МСК date parts, capitalised)", () => {
  it("EARS-16: yields twelve capitalised short МСК month names (Intl parts, not a hand abbreviation)", () => {
    const labels = monthShortLabels();
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe("Янв");
    expect(labels[6]).toBe("Июль");
    expect(labels[11]).toBe("Дек");
    // Every label is capitalised with no trailing period.
    for (const label of labels) {
      expect(label).toMatch(/^[А-Я][а-я]*$/);
    }
  });
});

/**
 * Scope item 10 (#1065, canvas update 2026-07-17): a desktop cell shows at most
 * 3 pills, LIVE events sorted first; the rest fold into the «+N ещё» link.
 */
describe("EARS-19: capDayEntries — 3-pill cap, live-first", () => {
  it("EARS-19: passes ≤3 entries through unchanged with zero overflow", () => {
    const entries = [
      entry("01", "2026-07-22T15:00:00.000Z"),
      entry("02", "2026-07-22T17:00:00.000Z"),
    ];
    const { visible, overflow } = capDayEntries(entries);
    expect(visible).toEqual(entries);
    expect(overflow).toBe(0);
  });

  it("EARS-19: caps at 3 and reports the folded remainder", () => {
    const entries = [
      entry("01", "2026-07-22T15:00:00.000Z"),
      entry("02", "2026-07-22T16:00:00.000Z"),
      entry("03", "2026-07-22T17:00:00.000Z"),
      entry("04", "2026-07-22T18:00:00.000Z"),
      entry("05", "2026-07-22T19:00:00.000Z"),
    ];
    const { visible, overflow } = capDayEntries(entries);
    expect(visible).toHaveLength(3);
    expect(overflow).toBe(2);
  });

  it("EARS-19: sorts a live event into the visible 3, keeping time order otherwise (stable)", () => {
    const entries = [
      entry("01", "2026-07-22T15:00:00.000Z"),
      entry("02", "2026-07-22T16:00:00.000Z"),
      entry("03", "2026-07-22T17:00:00.000Z"),
      entry("04", "2026-07-22T18:00:00.000Z", "live"),
    ];
    const { visible, overflow } = capDayEntries(entries);
    expect(visible.map((e) => e.slug)).toEqual([
      "event-04",
      "event-01",
      "event-02",
    ]);
    expect(overflow).toBe(1);
  });
});

describe("labels (МСК date parts, EARS-12)", () => {
  it("EARS-19: capitalises the month heading", () => {
    expect(formatMonthTitle("2026-07")).toBe("Июль 2026");
  });

  it("EARS-19: yields seven Monday-first weekday labels ending пн…вс", () => {
    const labels = weekdayShortLabels();
    expect(labels).toHaveLength(7);
    expect(labels[0]).toBe("пн");
    expect(labels[6]).toBe("вс");
  });
});
