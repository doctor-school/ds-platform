import { MOSCOW_TIME_ZONE, formatEventTime } from "@ds/schemas";

/**
 * Moscow-time presentation of the portal surfaces (004 EARS-12). Every helper
 * here is a projection of the one event-time formatter (`formatEventTime`,
 * `@ds/schemas`, registry row «Event time formatter») pinned to
 * `Europe/Moscow`, so the output is identical regardless of the server's or
 * browser's locale/TZ. The visible «МСК» label is copy — it lives in the
 * message catalog (EARS-13), not here; these helpers return only the localized
 * date/time parts.
 */
function inMoscow(isoInstant: string) {
  return formatEventTime({
    startsAt: isoInstant,
    viewerZone: MOSCOW_TIME_ZONE,
  });
}

export interface MskParts {
  /** e.g. `16 июля` */
  date: string;
  /** e.g. `19:00` */
  time: string;
}

export function formatMskParts(isoInstant: string): MskParts {
  const { date, time } = inMoscow(isoInstant);
  return { date, time };
}

/**
 * A stable calendar-day key (`YYYY-MM-DD`) for the instant in Europe/Moscow —
 * the grouping key for the day-grouped listing (004 EARS-7, design §5.2).
 */
export function mskDayKey(isoInstant: string): string {
  return inMoscow(isoInstant).groupDay;
}

/**
 * A stable calendar-month key (`YYYY-MM`) for the instant in Europe/Moscow —
 * the grouping key every month-grouped feed shares (the public archive listing
 * and the «Записи» tab of «Мои события», 014 EARS-9).
 */
export function mskMonthKey(isoInstant: string): string {
  return inMoscow(isoInstant).groupMonth;
}

/** The month-header label for a month-grouped feed — `«Июль 2026»`. */
export function formatMskMonth(isoInstant: string): string {
  return inMoscow(isoInstant).monthLabel;
}

/**
 * The day-header label for a listing group — `«16 июля, среда»` (date first,
 * weekday after), matching the §09 canvas rhythm.
 */
export function formatMskDayLabel(isoInstant: string): string {
  const { date, weekday } = inMoscow(isoInstant);
  return `${date}, ${weekday}`;
}

/**
 * The abbreviated Moscow weekday (`ср`) for a listing card's day sub-label
 * (`16 июля · ср`, the §09 canvas time-plate).
 */
export function formatMskWeekdayShort(isoInstant: string): string {
  return inMoscow(isoInstant).weekdayShort;
}
