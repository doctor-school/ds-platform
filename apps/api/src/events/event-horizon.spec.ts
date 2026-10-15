import { describe, expect, it } from "vitest";
import { addDoctorEventsFeedDays } from "@ds/schemas";
import {
  boundEventHorizonRows,
  clampRequestedEdge,
  EVENT_HORIZON_READ_ORDER,
  EVENT_HORIZON_ROW_CAP,
  eventHorizonReachingFirstMatch,
  eventHorizonInstants,
  EVENT_HORIZON_LAST_STEP,
  EVENT_HORIZON_STEP,
  holdBackEventHorizonRows,
  resolveEventHorizonBeyond,
  resolveEventHorizonFromData,
  type EventHorizon,
  type EventHorizonReach,
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

  const nothingBeyond = {
    nextCount: null,
    nextFrom: null,
    remaining: 0,
    nextBatch: 0,
  };

  it("past: a requested `from` older than every matching event is clamped to the earliest event's day — nothing is lost", () => {
    const horizon: EventHorizon = { from: "1900-01-01", to: "2026-10-09" };
    const rows = [at("2026-10-01"), at("2025-09-03")];
    expect(
      clampRequestedEdge(
        horizon,
        "past",
        rows,
        { from: "1900-01-01" },
        nothingBeyond,
      ),
    ).toEqual({ from: "2025-09-03", to: "2026-10-09" });
  });

  it("past: a requested `from` with older events beyond it is a real «Показать ещё» bound and stays as written", () => {
    const horizon: EventHorizon = { from: "2026-08-27", to: "2026-10-09" };
    const rows = [at("2026-09-08")];
    expect(
      clampRequestedEdge(
        horizon,
        "past",
        rows,
        { from: "2026-08-27" },
        {
          ...nothingBeyond,
          nextFrom: "2025-09-01",
          remaining: 1,
          nextBatch: 1,
        },
      ),
    ).toEqual(horizon);
  });

  it("past: the default `from` (not requested) is never moved", () => {
    const horizon: EventHorizon = { from: "2026-09-25", to: "2026-10-09" };
    expect(
      clampRequestedEdge(
        horizon,
        "past",
        [at("2026-10-01")],
        {},
        nothingBeyond,
      ),
    ).toEqual(horizon);
  });

  it("upcoming: a requested `to` past every matching event is clamped to the day after the latest event — nothing is lost", () => {
    const horizon: EventHorizon = { from: "2026-10-08", to: "2999-12-31" };
    const rows = [at("2026-10-09"), at("2027-03-04")];
    expect(
      clampRequestedEdge(
        horizon,
        "upcoming",
        rows,
        { to: "2999-12-31" },
        nothingBeyond,
      ),
    ).toEqual({ from: "2026-10-08", to: "2027-03-05" });
  });

  it("upcoming: a requested `to` with later events beyond it is a real «Показать ещё» bound and stays as written", () => {
    const horizon: EventHorizon = { from: "2026-10-08", to: "2026-10-20" };
    expect(
      clampRequestedEdge(
        horizon,
        "upcoming",
        [at("2026-10-09")],
        { to: "2026-10-20" },
        {
          ...nothingBeyond,
          nextCount: 2,
          remaining: 1,
          nextBatch: 1,
        },
      ),
    ).toEqual(horizon);
  });

  it("past: an extent holding more than the cap keeps the cap's OLDEST whole days, adjacent to the moving `from`, and moves the fixed `to` down to the cut day", () => {
    const days = Array.from(
      { length: 30 },
      (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`,
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
    const days = Array.from(
      { length: 30 },
      (_, i) => `2026-10-${String(30 - i).padStart(2, "0")}`,
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

  it("echoes the extent as its two days only — a resolved horizon's `heldBack` never rides into the strict response envelope (#2908)", () => {
    const resolved = { from: "2026-10-01", to: "2026-10-15", heldBack: 2 };
    const within = boundEventHorizonRows(resolved, "upcoming", [
      at("2026-10-02"),
    ]);
    expect(within.horizon).toStrictEqual({
      from: "2026-10-01",
      to: "2026-10-15",
    });
    const read = rowsOn(["2026-10-01", "2026-10-02"], 300).reverse();
    const capped = boundEventHorizonRows(
      resolved,
      "upcoming",
      read.slice(0, EVENT_HORIZON_ROW_CAP + 1),
    );
    expect(Object.keys(capped.horizon).sort()).toEqual(["from", "to"]);
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
  query: { from?: string; to?: string; count?: number },
) {
  const listStartsIn = async (range: EventHorizonReach) =>
    archive
      .filter(
        (row) =>
          (range.fromInstant === null || row.startsAt >= range.fromInstant) &&
          row.startsAt < range.toInstant,
      )
      .map((row) => row.startsAt);
  const requested = await resolveEventHorizonFromData(
    { tense, ...query },
    today,
    listStartsIn,
  );
  const { fromInstant, toInstant } = eventHorizonInstants(requested);
  const inside = archive
    .filter((row) => row.startsAt >= fromInstant && row.startsAt < toInstant)
    // `(startsAt, id)` in the read's direction, as both repositories order.
    .sort((a, b) => {
      const ascending =
        a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id);
      return EVENT_HORIZON_READ_ORDER[tense] === "asc" ? ascending : -ascending;
    })
    .slice(0, EVENT_HORIZON_ROW_CAP + 1);
  const bounded = boundEventHorizonRows(requested, tense, inside);
  const shown = holdBackEventHorizonRows(bounded.rows, requested.heldBack);
  const beyond = await resolveEventHorizonBeyond(
    bounded.horizon,
    tense,
    listStartsIn,
    { count: shown.length, heldBack: requested.heldBack },
  );
  return {
    ...clampRequestedEdge(bounded.horizon, tense, shown, query, beyond),
    ...beyond,
    ids: shown.map((row) => row.id),
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
    while (page.nextCount !== null) {
      const next = await readHorizon(archive, "upcoming", today, {
        from: page.from,
        count: page.nextCount,
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

  it("upcoming: «Будущие» has no far bound — the walk reaches an event however far ahead", async () => {
    const farAhead = addDoctorEventsFeedDays(today, 800);
    const archive = [...archiveOf(1, 300, 2), at(farAhead)];
    let page = await readHorizon(archive, "upcoming", today, {});
    while (page.nextCount !== null) {
      page = await readHorizon(archive, "upcoming", today, {
        from: page.from,
        count: page.nextCount,
      });
    }
    expect(page.ids).toContain(`${farAhead}-0`);
    expect(page.to).toBe(addDoctorEventsFeedDays(farAhead, 1));
  });
});

describe("eventHorizonReachingFirstMatch — the default extent opens on the first match (#1973)", () => {
  const beyond = (
    over: Partial<{
      nextCount: number | null;
      nextFrom: string | null;
      remaining: number;
    }>,
  ) => ({
    nextCount: null,
    nextFrom: null,
    remaining: 0,
    nextBatch: 0,
    ...over,
  });

  it("upcoming: the default extent is counted from the data, so it never needs re-reading", () => {
    expect(
      eventHorizonReachingFirstMatch(
        { tense: "upcoming" },
        0,
        beyond({ nextCount: 8, remaining: 8 }),
      ),
    ).toBeNull();
  });

  it("past: an empty DEFAULT window with older matches reads back to the next bound", () => {
    expect(
      eventHorizonReachingFirstMatch(
        { tense: "past" },
        0,
        beyond({ nextFrom: "2026-08-01", remaining: 3 }),
      ),
    ).toEqual({ from: "2026-08-01" });
  });

  it("a window holding a match, nothing beyond, or a moving edge the URL states is left as it is", () => {
    const some = beyond({
      nextCount: 2,
      nextFrom: "2026-08-01",
      remaining: 2,
    });
    expect(
      eventHorizonReachingFirstMatch({ tense: "upcoming" }, 1, some),
    ).toBeNull();
    expect(
      eventHorizonReachingFirstMatch({ tense: "upcoming" }, 0, beyond({})),
    ).toBeNull();
    expect(
      eventHorizonReachingFirstMatch(
        { tense: "past", from: "2026-09-01" },
        0,
        some,
      ),
    ).toBeNull();
  });
});

describe("019 LD-2 both tenses page by a count step of 10 events, not by days (#2768, #2884)", () => {
  const today = "2026-10-08";
  /** One event a day on each of the `days` days before today, oldest first. */
  const dailyBefore = (days: number) =>
    Array.from({ length: days }, (_, d) =>
      at(addDoctorEventsFeedDays(today, d - days)),
    );
  /** One event a day on each of the `days` days from tomorrow, soonest first. */
  const dailyAfter = (days: number) =>
    Array.from({ length: days }, (_, d) =>
      at(addDoctorEventsFeedDays(today, d + 1)),
    );

  it("the step is one constant of the read contract: 10 events", () => {
    expect(EVENT_HORIZON_STEP).toBe(10);
  });

  it("past: the default screen is the 10 most recent past events, however old", async () => {
    // One event every 9 days: a 14-day window would hold one or two.
    const archive = Array.from({ length: 25 }, (_, d) =>
      at(addDoctorEventsFeedDays(today, -9 * (d + 1))),
    );
    const page = await readHorizon(archive, "past", today, {});
    expect(page.ids).toEqual(archive.slice(0, 10).map((row) => row.id));
    expect(page.from).toBe(addDoctorEventsFeedDays(today, -90));
    expect(page.nextBatch).toBe(10);
    expect(page.remaining).toBe(15);
  });

  it("upcoming: the default screen is the 10 nearest upcoming events, however far ahead", async () => {
    // One event every 9 days: a 14-day window would hold one or two.
    const archive = Array.from({ length: 25 }, (_, d) =>
      at(addDoctorEventsFeedDays(today, 9 * (d + 1))),
    );
    const page = await readHorizon(archive, "upcoming", today, {});
    expect(page.ids).toEqual(archive.slice(0, 10).map((row) => row.id));
    expect(page.from).toBe(today);
    expect(page.to).toBe(addDoctorEventsFeedDays(today, 91));
    expect(page.nextCount).toBe(20);
    expect(page.nextBatch).toBe(10);
    expect(page.remaining).toBe(15);
  });

  it("EARS-3: with 11 or fewer upcoming events the screen holds them all and offers no «Показать ещё» — never a one-event tail", async () => {
    expect(EVENT_HORIZON_LAST_STEP).toBe(11);
    for (const count of [2, 10, 11]) {
      const page = await readHorizon(dailyAfter(count), "upcoming", today, {});
      expect(page.ids).toHaveLength(count);
      expect(page.nextCount).toBeNull();
      expect(page.remaining).toBe(0);
      expect(page.nextBatch).toBe(0);
    }
  });

  it("past: each «Показать ещё» adds the next 10 older events; the last step adds the remainder", async () => {
    const archive = dailyBefore(25);
    let page = await readHorizon(archive, "past", today, {});
    const screens = [page.ids.length];
    const batches = [page.nextBatch];
    while (page.nextFrom !== null) {
      page = await readHorizon(archive, "past", today, {
        from: page.nextFrom,
        to: page.to,
      });
      screens.push(page.ids.length);
      batches.push(page.nextBatch);
    }
    expect(screens).toEqual([10, 20, 25]);
    expect(batches).toEqual([10, 5, 0]);
    expect(page.remaining).toBe(0);
  });

  it("upcoming: each «Показать ещё» adds the next 10 later events; the last step adds the remainder", async () => {
    const archive = dailyAfter(25);
    let page = await readHorizon(archive, "upcoming", today, {});
    const screens = [page.ids.length];
    const batches = [page.nextBatch];
    const remainders = [page.remaining];
    while (page.nextCount !== null) {
      page = await readHorizon(archive, "upcoming", today, {
        from: page.from,
        count: page.nextCount,
      });
      screens.push(page.ids.length);
      batches.push(page.nextBatch);
      remainders.push(page.remaining);
    }
    expect(screens).toEqual([10, 20, 25]);
    expect(batches).toEqual([10, 5, 0]);
    expect(remainders).toEqual([15, 5, 0]);
  });

  it("past: the extent is whole days: a day the 10th event falls on is shown whole", async () => {
    // Nine single days, then a day holding three events.
    const archive = [
      ...rowsOn([addDoctorEventsFeedDays(today, -20)], 3),
      ...dailyBefore(9),
    ];
    const page = await readHorizon(archive, "past", today, {});
    expect(page.ids).toHaveLength(12);
    expect(page.remaining).toBe(0);
  });

  /** Walks «Будущие» from the default screen to the end, step by step. */
  const walkUpcoming = async (
    archive: readonly { id: string; startsAt: Date }[],
  ) => {
    let page = await readHorizon(archive, "upcoming", today, {});
    const pages = [page];
    while (page.nextCount !== null) {
      page = await readHorizon(archive, "upcoming", today, {
        from: page.from,
        count: page.nextCount,
      });
      pages.push(page);
    }
    return pages;
  };

  it("EARS-3: a step adds exactly 10 events even when the 10th shares its day with later ones (184 remaining → «ещё 10»)", async () => {
    // Ten single days, nine more, a day holding three events, then 172 singles.
    const archive = [
      ...dailyAfter(19),
      ...rowsOn([addDoctorEventsFeedDays(today, 20)], 3),
      ...Array.from({ length: 172 }, (_, d) =>
        at(addDoctorEventsFeedDays(today, 21 + d)),
      ),
    ];
    const first = await readHorizon(archive, "upcoming", today, {});
    expect(first.ids).toEqual(archive.slice(0, 10).map((row) => row.id));
    expect(first.remaining).toBe(184);
    expect(first.nextBatch).toBe(10);
    expect(first.nextCount).toBe(20);
    // The step ends inside the three-event day: exactly 10 more, not 12.
    const second = await readHorizon(archive, "upcoming", today, {
      from: first.from,
      count: first.nextCount!,
    });
    expect(second.ids).toEqual(archive.slice(0, 20).map((row) => row.id));
    expect(second.to).toBe(addDoctorEventsFeedDays(today, 21));
    expect(second.remaining).toBe(174);
    expect(second.nextBatch).toBe(10);
    // The rest of that day opens the next step.
    const third = await readHorizon(archive, "upcoming", today, {
      from: second.from,
      count: second.nextCount!,
    });
    expect(third.ids).toEqual(archive.slice(0, 30).map((row) => row.id));
  });

  it("EARS-3: 11 remaining → one last step adds all 11 and the list ends", async () => {
    const pages = await walkUpcoming(dailyAfter(21));
    expect(pages.map((page) => page.ids.length)).toEqual([10, 21]);
    expect(pages.map((page) => page.nextBatch)).toEqual([11, 0]);
    expect(pages.map((page) => page.remaining)).toEqual([11, 0]);
  });

  it("EARS-3: 12 remaining → a step of 10, then a last step of 2", async () => {
    const pages = await walkUpcoming(dailyAfter(22));
    expect(pages.map((page) => page.ids.length)).toEqual([10, 20, 22]);
    expect(pages.map((page) => page.nextBatch)).toEqual([10, 2, 0]);
  });

  it("EARS-3: the default screen holds exactly 10 even when the 10th shares its day with later ones", async () => {
    // Nine single days, then a day holding three events, then 5 more.
    const archive = [
      ...dailyAfter(9),
      ...rowsOn([addDoctorEventsFeedDays(today, 20)], 3),
      ...Array.from({ length: 5 }, (_, d) =>
        at(addDoctorEventsFeedDays(today, 21 + d)),
      ),
    ];
    const page = await readHorizon(archive, "upcoming", today, {});
    expect(page.ids).toEqual(archive.slice(0, 10).map((row) => row.id));
    expect(page.to).toBe(addDoctorEventsFeedDays(today, 21));
    expect(page.remaining).toBe(7);
    expect(page.nextBatch).toBe(7);
    expect(page.nextCount).toBe(17);
  });

  it("no event in the tense: the default screen is empty and offers no «Показать ещё»", async () => {
    const past = await readHorizon(
      [at(addDoctorEventsFeedDays(today, 3))],
      "past",
      today,
      {},
    );
    expect(past.ids).toEqual([]);
    expect(past.nextFrom).toBeNull();
    const upcoming = await readHorizon(
      [at(addDoctorEventsFeedDays(today, -3))],
      "upcoming",
      today,
      {},
    );
    expect(upcoming.ids).toEqual([]);
    expect(upcoming.nextCount).toBeNull();
  });

  it("a URL with an explicit `from`/`to` still addresses that range, answered as written", async () => {
    const archive = dailyAfter(25);
    const to = addDoctorEventsFeedDays(today, 4);
    const page = await readHorizon(archive, "upcoming", today, {
      from: today,
      to,
    });
    expect(page.ids).toHaveLength(3);
    expect(page.to).toBe(to);
    // The next step from a stated range is the next 10 events past it.
    expect(page.nextBatch).toBe(10);
    expect(page.nextCount).toBe(13);
    expect(page.remaining).toBe(22);
  });
});
