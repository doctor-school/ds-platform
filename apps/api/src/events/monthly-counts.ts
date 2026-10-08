import type { MonthlyEventCount } from "@ds/schemas";

/**
 * 004 EARS-16 — the month picker's dense year: exactly 12 rows `{ month,
 * count }`, a month with no events at `count: 0`, from a `month → count` map
 * that carries only the months that have events. ONE fill rule for both
 * storefronts' per-month counts reads (the Academy `month-counts` and the
 * doctor counterpart of wave-2 gate row 54), so the two pickers receive the
 * same shape by construction.
 */
export function denseMonthlyCounts(
  byMonth: ReadonlyMap<number, number>,
): MonthlyEventCount[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    count: byMonth.get(i + 1) ?? 0,
  }));
}

/** Tally 1-based month numbers into the `month → count` map {@link denseMonthlyCounts} fills. */
export function tallyMonths(months: Iterable<number>): Map<number, number> {
  const byMonth = new Map<number, number>();
  for (const month of months) byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  return byMonth;
}
