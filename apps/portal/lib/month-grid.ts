import type { MonthBroadcastEntry } from "@ds/schemas";

import { formatMskDayLabel, formatMskParts } from "./msk";

/**
 * 004 EARS-19 — the pure month-calendar layout logic behind the `?view=month`
 * pane (design §5.4). The read model stores one canonical UTC instant; every
 * calendar computation folds it into `Europe/Moscow` (EARS-12) using the fixed
 * МСК offset — no viewer-local drift, no tz-database lookup (Moscow is
 * permanently UTC+3, the same invariant `mskMonthRange` relies on). This module
 * is the single SSOT for the grid SHAPE (which МСК day each entry falls on, the
 * Monday-first 7-column matrix, today/past/weekend flags); the RU copy
 * (weekday/month names are Intl-formatted date PARTS per the `msk.ts` EARS-12
 * precedent; the fixed labels — legend, switcher, past-note, empty-state — live
 * in the message catalog, EARS-13) is composed in the portal layer, never here.
 */

const MSK_TIME_ZONE = "Europe/Moscow";

/** `YYYY-MM-DD` for an instant in Europe/Moscow (`en-CA` yields ISO order directly). */
const MSK_ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: MSK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The МСК calendar date parts (`{ year, month, day }`, month 1-based) for an instant. */
export function mskDateParts(instant: Date): {
  year: number;
  month: number;
  day: number;
} {
  const [y, m, d] = MSK_ISO_DAY.format(instant).split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** The current МСК calendar month as `YYYY-MM` — the month the `?view=month` pane opens on. */
export function currentMskMonth(now: Date = new Date()): string {
  return MSK_ISO_DAY.format(now).slice(0, 7);
}

/** Days in the given 1-based month (UTC arithmetic — day 0 of next month). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Step a `YYYY-MM` month by `deltaMonths`, rolling across year boundaries
 * (EARS-17 — the ‹ › month pager + the picker's year ‹ › steps, which are just
 * `±12`). Pure integer arithmetic on the (year·12 + monthIndex) ordinal — no
 * `Date`, no tz fold — so the result is always a valid, zero-padded
 * `MONTH_PARAM`-shaped value and the page never emits a malformed API param.
 */
export function shiftMonth(month: string, deltaMonths: number): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)); // 1..12
  const ordinal = year * 12 + (monthIndex - 1) + deltaMonths;
  const nextYear = Math.floor(ordinal / 12);
  const nextMonth = (ordinal % 12) + 1; // ordinal is non-negative for any real year
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

/**
 * Whether `month` (`YYYY-MM`) is strictly before the current МСК month — the
 * picker mutes an already-past month («прошёл», EARS-16). A lexicographic
 * `YYYY-MM` string compare is exact (fixed width, zero-padded), so no `Date`
 * math is needed; `now` is injected for testability.
 */
export function isMonthPast(month: string, now: Date = new Date()): boolean {
  return month < currentMskMonth(now);
}

/**
 * The Monday-first weekday index (0=Mon … 6=Sun) of a МСК calendar date. Anchored
 * at 12:00 UTC so the +3 МСК fold never crosses a day boundary — the calendar
 * date is stable regardless of the runtime timezone (EARS-12).
 */
function mondayFirstWeekday(year: number, month: number, day: number): number {
  const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay(); // 0=Sun
  return (dow + 6) % 7;
}

/** A comparable integer `YYYYMMDD` for ordering calendar dates without Date math. */
function ymd(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/** One day cell of the month grid — an in-month day or a leading/trailing neighbour day. */
export interface MonthDayCell {
  /** The day-of-month NUMBER shown in the cell (a neighbour month's number when `inMonth` is false). */
  day: number;
  /** `true` for the shown month's own days; `false` for the leading/trailing filler cells. */
  inMonth: boolean;
  /** The shown month + day (`YYYY-MM-DD`, МСК) for an in-month cell; `null` for filler cells. */
  isoDay: string | null;
  /** `true` only for today's МСК date within the shown month. */
  isToday: boolean;
  /** `true` for an in-month day strictly before today (rendered as a muted aggregate note). */
  isPast: boolean;
  /** `true` for Sat/Sun (a faint cell background in the canvas). */
  isWeekend: boolean;
  /** The publish-visible events on this МСК day, nearest-first (backend order preserved). */
  entries: MonthBroadcastEntry[];
}

export interface MonthGrid {
  /** The shown month, `YYYY-MM`. */
  month: string;
  year: number;
  /** 1-based calendar month. */
  monthIndex: number;
  /** Monday-first weeks, each exactly 7 cells (5 or 6 rows). */
  weeks: MonthDayCell[][];
  /** Today's day-of-month when the shown month IS the current МСК month; else `null`. */
  todayDom: number | null;
}

/**
 * Build the Monday-first month grid for `month` (`YYYY-MM`) from the month's
 * publish-visible entries (`GET /v1/public/events?month=`). Entries are bucketed
 * onto their МСК calendar day; days before today are `isPast`, today is flagged,
 * weekends are marked. Leading/trailing filler cells carry the neighbour month's
 * real day numbers (`inMonth: false`) so the 7-column rhythm reads continuously,
 * matching `webinars-month.dc.html`. Pure — `now` is injected for testability.
 */
export function buildMonthGrid(params: {
  month: string;
  entries: readonly MonthBroadcastEntry[];
  now?: Date;
}): MonthGrid {
  const { month, entries, now = new Date() } = params;
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));

  // Bucket entries by their МСК day-of-month (backend scopes to this month).
  const byDay = new Map<number, MonthBroadcastEntry[]>();
  for (const entry of entries) {
    const { day } = mskDateParts(new Date(entry.startsAt));
    const bucket = byDay.get(day);
    if (bucket) bucket.push(entry);
    else byDay.set(day, [entry]);
  }

  const today = mskDateParts(now);
  const isCurrentMonth = today.year === year && today.month === monthIndex;
  const todayOrdinal = ymd(today.year, today.month, today.day);

  const total = daysInMonth(year, monthIndex);
  const leading = mondayFirstWeekday(year, monthIndex, 1);
  const prevMonthDays = daysInMonth(
    monthIndex === 1 ? year - 1 : year,
    monthIndex === 1 ? 12 : monthIndex - 1,
  );

  const cells: MonthDayCell[] = [];

  // Leading filler — the tail of the previous month.
  for (let i = 0; i < leading; i++) {
    const day = prevMonthDays - leading + 1 + i;
    cells.push({
      day,
      inMonth: false,
      isoDay: null,
      isToday: false,
      isPast: false,
      isWeekend: false,
      entries: [],
    });
  }

  // In-month days.
  for (let day = 1; day <= total; day++) {
    const weekday = mondayFirstWeekday(year, monthIndex, day);
    const ordinal = ymd(year, monthIndex, day);
    const isToday = isCurrentMonth && day === today.day;
    cells.push({
      day,
      inMonth: true,
      isoDay: `${month}-${String(day).padStart(2, "0")}`,
      isToday,
      isPast: !isToday && ordinal < todayOrdinal,
      isWeekend: weekday >= 5,
      entries: byDay.get(day) ?? [],
    });
  }

  // Trailing filler — the head of the next month, to complete the last row.
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let day = 1; day <= trailing; day++) {
    cells.push({
      day,
      inMonth: false,
      isoDay: null,
      isToday: false,
      isPast: false,
      isWeekend: false,
      entries: [],
    });
  }

  const weeks: MonthDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    month,
    year,
    monthIndex,
    weeks,
    todayDom: isCurrentMonth ? today.day : null,
  };
}

/**
 * The month heading — «Июль 2026» (МСК, capitalised). An Intl-formatted date part
 * (the `msk.ts` EARS-12 precedent: date/time PARTS are locale-formatted, only the
 * fixed «МСК»/legend/switcher LABELS are catalog copy). Anchored at day 15 12:00
 * МСК so the fold never crosses a month boundary.
 */
const MSK_MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  month: "long",
  year: "numeric",
});
export function formatMonthTitle(month: string): string {
  const label = MSK_MONTH_YEAR.format(new Date(`${month}-15T12:00:00+03:00`))
    // `ru-RU` appends the era marker « г.» — drop it to match the canvas token.
    .replace(/\s*г\.?$/, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The seven Monday-first weekday header labels («пн»…«вс»), Intl-derived (not
 * hardcoded RU) from a known-Monday reference week (2024-01-01 is a Monday),
 * anchored at 12:00 UTC and with the `ru-RU` trailing period stripped to match
 * the canvas token.
 */
const MSK_WEEKDAY_SHORT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  weekday: "short",
});
export function weekdayShortLabels(): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    MSK_WEEKDAY_SHORT.format(new Date(Date.UTC(2024, 0, 1 + i, 12))).replace(
      /\.$/,
      "",
    ),
  );
}

/**
 * The twelve short month names («Янв»…«Дек») for the 12-month picker (EARS-16),
 * Intl-derived МСК date PARTS (the `msk.ts` EARS-12 precedent — not hardcoded
 * RU), capitalised and with the `ru-RU` trailing period stripped to match the
 * canvas token. Anchored at day 15 12:00 UTC so the fold never crosses a month.
 */
const MSK_MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  month: "short",
});
export function monthShortLabels(): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const label = MSK_MONTH_SHORT.format(new Date(Date.UTC(2024, i, 15, 12)))
      .replace(/\.$/, "");
    return label.charAt(0).toUpperCase() + label.slice(1);
  });
}

/**
 * The full day heading for the mobile agenda («16 июля, среда»), МСК, reusing the
 * shared listing formatter so it agrees with the grouped week list. The «сегодня»
 * suffix is catalog copy appended by the caller.
 */
export function formatAgendaDayTitle(isoDay: string): string {
  return formatMskDayLabel(`${isoDay}T12:00:00+03:00`);
}

/** The МСК start time of an entry, e.g. `19:00` (EARS-12). */
/** The desktop day-cell pill cap (canvas update 2026-07-17, #1065 item 10). */
export const DAY_PILL_CAP = 3;

/**
 * Cap a day's entries for the desktop grid: at most `max` pills, LIVE events
 * sorted first (stable — backend nearest-first order preserved otherwise); the
 * folded remainder count drives the «+N ещё» overflow link.
 */
export function capDayEntries(
  entries: readonly MonthBroadcastEntry[],
  max: number = DAY_PILL_CAP,
): { visible: MonthBroadcastEntry[]; overflow: number } {
  const sorted = [...entries].sort(
    (a, b) => Number(b.state === "live") - Number(a.state === "live"),
  );
  return { visible: sorted.slice(0, max), overflow: Math.max(0, sorted.length - max) };
}

export function entryTime(entry: MonthBroadcastEntry): string {
  return formatMskParts(entry.startsAt).time;
}
