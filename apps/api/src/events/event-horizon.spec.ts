import { describe, expect, it } from "vitest";
import { addDoctorEventsFeedDays } from "@ds/schemas";
import {
  boundEventHorizonRows,
  clampRequestedPastFrom,
  EVENT_HORIZON_READ_ORDER,
  EVENT_HORIZON_ROW_CAP,
  eventHorizonReachingFirstMatch,
  eventHorizonInstants,
  resolveEventHorizon,
  resolveEventHorizonBeyond,
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

  it("past: an extent holding more than the cap keeps the cap's OLDEST whole days, adjacent to the moving `from`, and moves the fixed `to` down to the cut day", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      `2026-09-${String(i + 1).padStart(2, "0")}`,
    );
    // 30 days x 20 = 600 rows; the past read hands the CAP + 1 OLDEST, oldest first.
    const read = rowsOn(days, 20).slice(0, EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-09-01", to: "2026-10-01" },
      "past",
      read,
    );
    // 500 rows = 25 whole days; the 26th day (2026-09-26) is cut, so it is dropped.
    expect(bound.rows).toHaveLength(EVENT_HORIZON_ROW_CAP);
    expect(bound.horizon).toEqual({ from: "2026-09-01", to: "2026-09-26" });
    // Returned in display order: newest first.
    expect(bound.rows[0]!.id).toBe("2026-09-25-19");
    expect(bound.rows.at(-1)!.id).toBe("2026-09-01-0");
  });

  it("past: a day split by the cap is dropped whole, never half-rendered", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const read = rowsOn(days, 300).slice(0, EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-09-01", to: "2026-10-01" },
      "past",
      read,
    );
    expect(bound.rows).toHaveLength(300);
    expect(bound.horizon).toEqual({ from: "2026-09-01", to: "2026-09-02" });
  });

  it("upcoming: an extent holding more than the cap keeps the cap's FARTHEST whole days, adjacent to the moving `to`, and moves the fixed `from` past the cut day", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      `2026-10-${String(30 - i).padStart(2, "0")}`,
    );
    // The upcoming read hands the CAP + 1 FARTHEST, farthest first.
    const read = rowsOn(days, 20).slice(0, EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-10-01", to: "2026-10-31" },
      "upcoming",
      read,
    );
    expect(bound.rows).toHaveLength(EVENT_HORIZON_ROW_CAP);
    expect(bound.horizon).toEqual({ from: "2026-10-06", to: "2026-10-31" });
    // Returned in display order: soonest first.
    expect(bound.rows[0]!.id).toBe("2026-10-06-19");
    expect(bound.rows.at(-1)!.id).toBe("2026-10-30-0");
  });

  it("a single day holding more than the cap still answers at most the cap", () => {
    const read = rowsOn(["2026-09-30"], EVENT_HORIZON_ROW_CAP + 1);
    const bound = boundEventHorizonRows(
      { from: "2026-09-01", to: "2026-10-01" },
      "past",
      read,
    );
    expect(bound.rows).toHaveLength(EVENT_HORIZON_ROW_CAP);
    expect(bound.horizon).toEqual({ from: "2026-09-01", to: "2026-10-01" });
  });

  it("an extent within the cap is returned unchanged", () => {
    const horizon: EventHorizon = { from: "2026-10-01", to: "2026-10-15" };
    const rows = [at("2026-10-02"), at("2026-10-03")];
    // A within-cap read arrives moving-edge first and leaves in display order.
    expect(
      boundEventHorizonRows(horizon, "upcoming", [...rows].reverse()),
    ).toEqual({ horizon, rows });
  });
});

/**
 * One horizon read over an in-memory archive, exactly as both services run it:
 * resolve -> read the CAP + 1 rows from the moving edge -> bound -> beyond -> clamp.
 */
async function readHorizon(
  archive: readonly { id: string; startsAt: Date }[],
  tense: "upcoming" | "past",
  today: string,
  query: { from?: string; to?: string },
) {
  const requested = resolveEventHorizon({ tense, ...query }, today);
  const { fromInstant, toInstant } = eventHorizonInstants(requested);
  const inside = archive
    .filter((row) => row.startsAt >= fromInstant && row.startsAt < toInstant)
    .sort((a, b) =>
      EVENT_HORIZON_READ_ORDER[tense] === "asc"
        ? a.startsAt.getTime() - b.startsAt.getTime()
        : b.startsAt.getTime() - a.startsAt.getTime(),
    )
    .slice(0, EVENT_HORIZON_ROW_CAP + 1);
  const bounded = boundEventHorizonRows(requested, tense, inside);
  const beyond = await resolveEventHorizonBeyond(
    bounded.horizon,
    tense,
    today,
    async (range) =>
      archive
        .filter(
          (row) =>
            (range.fromInstant === null || row.startsAt >= range.fromInstant) &&
            row.startsAt < range.toInstant,
        )
        .map((row) => row.startsAt),
  );
  return {
    ...clampRequestedPastFrom(
      bounded.horizon,
      tense,
      bounded.rows,
      query.from,
      beyond,
    ),
    ...beyond,
    ids: bounded.rows.map((row) => row.id),
  };
}

describe("the capped window slides with «Показать ещё» (wave-2 gate row 32)", () => {
  const today = "2026-10-08";
  /** `perDay` rows on each of `days` consecutive days, starting `start` days from today. */
  const archiveOf = (start: number, days: number, perDay: number) =>
    Array.from({ length: days }, (_, d) =>
      rowsOn([addDoctorEventsFeedDays(today, start + d)], perDay),
    ).flat();

  it("past: every «Показать ещё» past the cap brings new events, the page never exceeds the cap, the walk reaches the oldest event and ends", async () => {
    // 600 archived events at 2 a day across the 300 days before today.
    const archive = archiveOf(-300, 300, 2);
    const oldest = archive[0]!.id;
    let page = await readHorizon(archive, "past", today, {});
    let steps = 0;
    while (page.nextFrom !== null) {
      const next = await readHorizon(archive, "past", today, {
        from: page.nextFrom,
        to: page.to,
      });
      expect(next.ids.length).toBeLessThanOrEqual(EVENT_HORIZON_ROW_CAP);
      expect(next.ids.some((id) => !page.ids.includes(id))).toBe(true);
      page = next;
      expect(++steps).toBeLessThan(100);
    }
    expect(page.ids).toContain(oldest);
    expect(page.remaining).toBe(0);
    expect(page.nextBatch).toBe(0);
    // The cap was crossed: the fixed `to` moved down from its default.
    expect(page.to < addDoctorEventsFeedDays(today, 1)).toBe(true);
  });

  it("upcoming: every «Показать ещё» past the cap brings new events, the walk reaches the farthest event and ends", async () => {
    // 600 events at 2 a day across the 300 days from tomorrow.
    const archive = archiveOf(1, 300, 2);
    const farthest = archive.at(-1)!.id;
    let page = await readHorizon(archive, "upcoming", today, {});
    let steps = 0;
    while (page.nextTo !== null) {
      const next = await readHorizon(archive, "upcoming", today, {
        from: page.from,
        to: page.nextTo,
      });
      expect(next.ids.length).toBeLessThanOrEqual(EVENT_HORIZON_ROW_CAP);
      expect(next.ids.some((id) => !page.ids.includes(id))).toBe(true);
      page = next;
      expect(++steps).toBeLessThan(100);
    }
    expect(page.ids).toContain(farthest);
    expect(page.remaining).toBe(0);
    // The cap was crossed: the fixed `from` moved up from today.
    expect(page.from > today).toBe(true);
  });

  it("upcoming: the widest horizon stays anchored on today after the window slides", async () => {
    const beyondCeiling = addDoctorEventsFeedDays(today, 400);
    const archive = [...archiveOf(1, 300, 2), at(beyondCeiling)];
    let page = await readHorizon(archive, "upcoming", today, {});
    while (page.nextTo !== null) {
      page = await readHorizon(archive, "upcoming", today, {
        from: page.from,
        to: page.nextTo,
      });
    }
    expect(page.to <= addDoctorEventsFeedDays(today, 365)).toBe(true);
    expect(page.ids).not.toContain(`${beyondCeiling}-0`);
  });
});

describe("eventHorizonReachingFirstMatch — the default extent opens on the first match (#1973)", () => {
  const beyond = (over: Partial<{ nextTo: string | null; nextFrom: string | null; remaining: number }>) => ({
    nextTo: null,
    nextFrom: null,
    remaining: 0,
    nextBatch: 0,
    ...over,
  });

  it("upcoming: an empty DEFAULT window with matches beyond reads up to the next bound", () => {
    expect(
      eventHorizonReachingFirstMatch({ tense: "upcoming" }, 0, beyond({ nextTo: "2026-11-30", remaining: 8 })),
    ).toEqual({ to: "2026-11-30" });
  });

  it("past: an empty DEFAULT window with older matches reads back to the next bound", () => {
    expect(
      eventHorizonReachingFirstMatch({ tense: "past" }, 0, beyond({ nextFrom: "2026-08-01", remaining: 3 })),
    ).toEqual({ from: "2026-08-01" });
  });

  it("a window holding a match, nothing beyond, or a moving edge the URL states is left as it is", () => {
    const some = beyond({ nextTo: "2026-11-30", nextFrom: "2026-08-01", remaining: 2 });
    expect(eventHorizonReachingFirstMatch({ tense: "upcoming" }, 1, some)).toBeNull();
    expect(eventHorizonReachingFirstMatch({ tense: "upcoming" }, 0, beyond({}))).toBeNull();
    expect(eventHorizonReachingFirstMatch({ tense: "upcoming", to: "2026-10-20" }, 0, some)).toBeNull();
    expect(eventHorizonReachingFirstMatch({ tense: "past", from: "2026-09-01" }, 0, some)).toBeNull();
  });
});
