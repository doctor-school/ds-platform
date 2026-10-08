import { describe, expect, it } from "vitest";
import {
  boundEventHorizonRows,
  clampRequestedPastFrom,
  EVENT_HORIZON_ROW_CAP,
  type EventHorizon,
} from "./event-horizon.js";

/** A row starting at noon МСК of `day` (`YYYY-MM-DD`). */
const at = (day: string, n = 0) => ({
  id: `${day}-${n}`,
  startsAt: new Date(`${day}T12:00:00+03:00`),
});

/** `count` rows per day for each listed day, in the given (read) order. */
const rowsOn = (days: readonly string[], count: number) =>
  days.flatMap((day) => Array.from({ length: count }, (_, n) => at(day, n)));

describe("boundEventHorizonRows — one horizon response stays bounded (wave-2 gate row 32)", () => {
  it("the cap is one named, generous constant", () => {
    expect(EVENT_HORIZON_ROW_CAP).toBe(500);
  });

  const nothingBeyond = { nextTo: null, nextFrom: null, remaining: 0, nextBatch: 0 };

  it("past: a requested `from` older than every matching event is clamped to the earliest event's day — nothing is lost", () => {
    const horizon: EventHorizon = { from: "1900-01-01", to: "2026-10-09" };
    const rows = [at("2026-10-01"), at("2025-09-03")];
    expect(
      clampRequestedPastFrom(horizon, "past", rows, "1900-01-01", nothingBeyond),
    ).toEqual({ from: "2025-09-03", to: "2026-10-09" });
  });

  it("past: a requested `from` with older events beyond it is a real «Показать ещё» bound and stays as written", () => {
    const horizon: EventHorizon = { from: "2026-08-27", to: "2026-10-09" };
    const rows = [at("2026-09-08")];
    expect(
      clampRequestedPastFrom(horizon, "past", rows, "2026-08-27", {
        ...nothingBeyond,
        nextFrom: "2025-09-01",
        remaining: 1,
        nextBatch: 1,
      }),
    ).toEqual(horizon);
  });

  it("past: the default `from` (not requested) is never moved", () => {
    const horizon: EventHorizon = { from: "2026-09-25", to: "2026-10-09" };
    expect(
      clampRequestedPastFrom(horizon, "past", [at("2026-10-01")], undefined, nothingBeyond),
    ).toEqual(horizon);
  });

  it("past: an extent holding more than the cap returns the cap's newest WHOLE days and moves `from` to the oldest kept day", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      `2026-09-${String(30 - i).padStart(2, "0")}`,
    );
    // 30 days × 20 = 600 rows newest first; the read hands at most CAP + 1.
    const all = rowsOn(days, 20);
    const read = all.slice(0, EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2000-01-01", to: "2026-10-01" },
      "past",
      read,
    );
    // 500 rows = 25 whole days; the 26th day (2026-09-05) is cut, so it is dropped.
    expect(bound.rows).toHaveLength(EVENT_HORIZON_ROW_CAP);
    expect(bound.horizon).toEqual({ from: "2026-09-06", to: "2026-10-01" });
    expect(bound.rows.every((row) => row.id >= "2026-09-06")).toBe(true);
  });

  it("past: a day split by the cap is dropped whole, never half-rendered", () => {
    const days = ["2026-09-30", "2026-09-29", "2026-09-28"];
    const read = rowsOn(days, 300).slice(0, EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-09-01", to: "2026-10-01" },
      "past",
      read,
    );
    expect(bound.rows).toHaveLength(300);
    expect(bound.horizon).toEqual({ from: "2026-09-30", to: "2026-10-01" });
  });

  it("upcoming: an extent holding more than the cap returns the cap's soonest whole days and moves `to` before the cut day", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      `2026-10-${String(i + 1).padStart(2, "0")}`,
    );
    const read = rowsOn(days, 20).slice(0, EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-10-01", to: "2027-09-30" },
      "upcoming",
      read,
    );
    expect(bound.rows).toHaveLength(EVENT_HORIZON_ROW_CAP);
    expect(bound.horizon).toEqual({ from: "2026-10-01", to: "2026-10-26" });
  });

  it("a single day holding more than the cap still answers at most the cap", () => {
    const read = rowsOn(["2026-09-30"], EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-09-01", to: "2026-10-01" },
      "past",
      read,
    );
    expect(bound.rows).toHaveLength(EVENT_HORIZON_ROW_CAP);
    expect(bound.horizon).toEqual({ from: "2026-09-30", to: "2026-10-01" });
  });

  it("an extent within the cap is returned unchanged", () => {
    const horizon: EventHorizon = { from: "2026-10-01", to: "2026-10-15" };
    const rows = [at("2026-10-02"), at("2026-10-03")];
    expect(boundEventHorizonRows(horizon, "upcoming", rows)).toEqual(
      { horizon, rows },
    );
  });
});
