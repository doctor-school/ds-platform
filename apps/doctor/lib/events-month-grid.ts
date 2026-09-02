import type { DotGridCell, DotKind } from "@ds/design-system/blocks";
import {
  type DoctorEventsMonthGrid,
  doctorEventsMonthNextFirstDay,
  doctorEventsMonthOf,
  type RawQueryValue,
} from "@ds/schemas";
import { encodeDoctorEventsFeedQuery } from "@/lib/events-feed";

/**
 * 019 EARS-4 (#1519) — the projection of the `MonthGrid` read onto the SHARED
 * `MonthDotGrid` presentation unit, plus the RU copy that sits beside
 * `DOCTOR_EVENTS_FEED_COPY`.
 *
 * The unit is presentation-only by contract, so the МСК day bucketing, the
 * today/past flags, the accessible day summaries and every href are computed
 * HERE and passed in. Nothing about the month is re-derived from the feed: the
 * counts and the live marker come from `GET /v1/storefront/doctor/events/month`
 * (LD-3, EARS-15), which decodes its facets with the feed's own codec.
 *
 * Every href is built from the SHARED feed codec (`encodeDoctorEventsFeedQuery`)
 * with `day` / `month` written onto the result — a hand-assembled query string
 * would be the second query model LD-1 exists to prevent.
 */

/** Monday-first weekday header labels — canvas `dows`. */
export const DOCTOR_EVENTS_MONTH_WEEKDAYS = [
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
  "Вс",
] as const;

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

const MONTH_NAMES_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/** RU copy for the calendar pane — the sibling of `DOCTOR_EVENTS_FEED_COPY`. */
export const DOCTOR_EVENTS_MONTH_COPY = {
  /** The pane's accessible name; the visible heading is the month label. */
  paneLabel: "Календарь месяца",
  todayMark: "сегодня",
  liveMark: "идёт эфир",
  prevMonth: "Предыдущий месяц",
  nextMonth: "Следующий месяц",
  empty: "нет событий",
} as const;

/** «3 эфира» — the RU count form used in the day's accessible summary. */
export function doctorEventsCountLabel(count: number): string {
  if (count === 0) return DOCTOR_EVENTS_MONTH_COPY.empty;
  const tail = count % 10;
  const teen = count % 100;
  const noun =
    teen >= 11 && teen <= 14
      ? "эфиров"
      : tail === 1
        ? "эфир"
        : tail >= 2 && tail <= 4
          ? "эфира"
          : "эфиров";
  return `${count} ${noun}`;
}

/** «Сентябрь 2026» — the pane heading. */
export function doctorEventsMonthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[index - 1]} ${year}`;
}

/** The ISO month one step before `month`. */
export function doctorEventsMonthPrev(month: string): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return index === 1
    ? `${year - 1}-12`
    : `${year}-${String(index - 1).padStart(2, "0")}`;
}

/** The ISO month one step after `month`, via the schema's own next-first-day. */
export function doctorEventsMonthNext(month: string): string {
  return doctorEventsMonthOf(doctorEventsMonthNextFirstDay(month));
}

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

/** Monday-first index (0…6) of an ISO day. */
function mondayFirstIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The last day-of-month number — day 0 of the FOLLOWING month, in UTC. */
function daysInMonth(month: string): number {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/**
 * The dots a day carries, capped at the unit's three. `hasLive` takes the first
 * slot so the live signal survives the cap; an already-past day reads as the
 * muted `past` kind rather than as a planned event (release 1 is «Будущие»
 * only — LD-10 — so a past day normally carries `count: 0` anyway).
 */
function dotsFor(count: number, hasLive: boolean, past: boolean): DotKind[] {
  if (count === 0) return [];
  const capped = Math.min(count, 3);
  if (past) return Array.from({ length: capped }, () => "past" as const);
  if (!hasLive) return Array.from({ length: capped }, () => "event" as const);
  return [
    "live" as const,
    ...Array.from({ length: capped - 1 }, () => "event" as const),
  ];
}

/**
 * The day button's accessible summary — «16 сентября, сегодня, 2 эфира, идёт
 * эфир». The dots are decorative, so this string is the ONLY carrier of the
 * live signal for a screen reader and the reason colour is never the sole cue
 * (WCAG 1.4.1).
 */
function ariaLabelFor(
  date: string,
  count: number,
  hasLive: boolean,
  today: boolean,
): string {
  const index = Number(date.slice(5, 7));
  const parts = [`${dayNumber(date)} ${MONTH_NAMES_GENITIVE[index - 1]}`];
  if (today) parts.push(DOCTOR_EVENTS_MONTH_COPY.todayMark);
  parts.push(doctorEventsCountLabel(count));
  if (hasLive) parts.push(DOCTOR_EVENTS_MONTH_COPY.liveMark);
  return parts.join(", ");
}

/** What the client pane needs: the unit's props plus the href each day navigates to. */
export interface DoctorEventsMonthPane {
  month: string;
  monthLabel: string;
  weekdays: readonly string[];
  weeks: readonly (readonly DotGridCell[])[];
  /** Day-of-month → the feed URL that selects that day. In-month days only. */
  dayHrefs: Record<number, string>;
  selectedDay: number | null;
  prevMonthHref: string;
  nextMonthHref: string;
}

/**
 * The feed URL that selects `date` — the CURRENT query with `day` written onto
 * it, so the selection is shareable, survives the back button, and reaches the
 * api through the one codec both reads decode with (LD-1, EARS-8).
 */
export function doctorEventsDayHref(
  raw: Record<string, RawQueryValue>,
  date: string,
): string {
  const params = encodeDoctorEventsFeedQuery(raw);
  params.set("day", date);
  params.set("month", doctorEventsMonthOf(date));
  return `/events?${params.toString()}`;
}

/** The URL that moves the CALENDAR to `month`, dropping the day selection. */
export function doctorEventsMonthHref(
  raw: Record<string, RawQueryValue>,
  month: string,
): string {
  const params = encodeDoctorEventsFeedQuery(raw);
  params.delete("day");
  params.set("month", month);
  return `/events?${params.toString()}`;
}

export function toDoctorEventsMonthPane(
  grid: DoctorEventsMonthGrid,
  raw: Record<string, RawQueryValue>,
): DoctorEventsMonthPane {
  const byDate = new Map(grid.days.map((day) => [day.date, day]));
  const lead = mondayFirstIndex(`${grid.month}-01`);
  const length = daysInMonth(grid.month);

  const cells: DotGridCell[] = [];
  const dayHrefs: Record<number, string> = {};

  // Neighbour-month filler carries its REAL date number (standard calendar
  // practice) and stays non-interactive — `inMonth: false` disables the cell.
  const prevLength = daysInMonth(doctorEventsMonthPrev(grid.month));
  for (let i = lead; i > 0; i -= 1) {
    const day = prevLength - i + 1;
    cells.push({ day, inMonth: false, dots: [], ariaLabel: String(day) });
  }

  for (let day = 1; day <= length; day += 1) {
    const date = `${grid.month}-${String(day).padStart(2, "0")}`;
    const read = byDate.get(date);
    const count = read?.count ?? 0;
    const hasLive = read?.hasLive ?? false;
    const today = date === grid.today;
    cells.push({
      day,
      inMonth: true,
      today: today || undefined,
      dots: dotsFor(count, hasLive, date < grid.today),
      ariaLabel: ariaLabelFor(date, count, hasLive, today),
    });
    dayHrefs[day] = doctorEventsDayHref(raw, date);
  }

  for (let day = 1; cells.length % 7 !== 0; day += 1) {
    cells.push({ day, inMonth: false, dots: [], ariaLabel: String(day) });
  }

  const weeks: DotGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const selected = Array.isArray(raw.day) ? raw.day[0] : raw.day;
  const selectedDay =
    typeof selected === "string" &&
    doctorEventsMonthOf(selected) === grid.month &&
    dayHrefs[dayNumber(selected)] !== undefined
      ? dayNumber(selected)
      : null;

  return {
    month: grid.month,
    monthLabel: doctorEventsMonthLabel(grid.month),
    weekdays: DOCTOR_EVENTS_MONTH_WEEKDAYS,
    weeks,
    dayHrefs,
    selectedDay,
    prevMonthHref: doctorEventsMonthHref(raw, doctorEventsMonthPrev(grid.month)),
    nextMonthHref: doctorEventsMonthHref(raw, doctorEventsMonthNext(grid.month)),
  };
}
