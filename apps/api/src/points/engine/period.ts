// 025 EARS-36 — the calendar period of a `countPer` limit, in Europe/Moscow.
//
// Moscow has kept a fixed UTC+3 offset with no daylight saving since
// 2014-10-26, so a period boundary is the UTC+3 midnight shifted back by three
// hours; the engine never counts facts before 2026, so no historical offset
// applies. `week` starts on Monday (ISO 8601).

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PointsCountPeriod = "day" | "week" | "month";

/** [start, end) of the Europe/Moscow calendar `period` containing `at`. */
export function moscowPeriod(
  period: PointsCountPeriod,
  at: Date,
): { start: Date; end: Date } {
  const local = new Date(at.getTime() + MOSCOW_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  let startLocal: number;
  let endLocal: number;
  switch (period) {
    case "day":
      startLocal = Date.UTC(y, m, d);
      endLocal = startLocal + DAY_MS;
      break;
    case "week": {
      const sinceMonday = (local.getUTCDay() + 6) % 7;
      startLocal = Date.UTC(y, m, d - sinceMonday);
      endLocal = startLocal + 7 * DAY_MS;
      break;
    }
    case "month":
      startLocal = Date.UTC(y, m, 1);
      endLocal = Date.UTC(y, m + 1, 1);
      break;
  }
  return {
    start: new Date(startLocal - MOSCOW_OFFSET_MS),
    end: new Date(endLocal - MOSCOW_OFFSET_MS),
  };
}
