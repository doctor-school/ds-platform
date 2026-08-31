/**
 * Canonical Moscow-time presentation (004 EARS-12). The read model stores one
 * canonical UTC instant; every portal surface renders it in `Europe/Moscow` and
 * MUST NOT drift to the viewer's local timezone. This is the single formatter
 * both webinar surfaces share — it pins `timeZone: "Europe/Moscow"` explicitly,
 * so the output is identical regardless of the server's or browser's locale/TZ.
 * The visible «МСК» label is copy — it lives in the message catalog (EARS-13),
 * not here; this helper returns only the localized date/time parts.
 */
const MSK_TIME_ZONE = "Europe/Moscow";

export interface MskParts {
  /** e.g. `16 июля` */
  date: string;
  /** e.g. `19:00` */
  time: string;
}

export function formatMskParts(isoInstant: string): MskParts {
  const instant = new Date(isoInstant);
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MSK_TIME_ZONE,
    day: "numeric",
    month: "long",
  }).format(instant);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MSK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
  return { date, time };
}

/**
 * A stable calendar-day key (`YYYY-MM-DD`) for the instant **in Europe/Moscow**
 * — the grouping key for the day-grouped listing (004 EARS-7, design §5.2). Two
 * events on the same МСК day share this key regardless of the server's/browser's
 * timezone, so the day grouping never drifts (EARS-12). `en-CA` yields the
 * ISO-ordered `YYYY-MM-DD` form directly.
 */
const MSK_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: MSK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function mskDayKey(isoInstant: string): string {
  return MSK_DAY_KEY.format(new Date(isoInstant));
}

/**
 * A stable calendar-MONTH key (`YYYY-MM`) for the instant **in Europe/Moscow** —
 * the grouping key every month-grouped feed shares (the public archive listing
 * and the «Записи» tab of «Мои события», 014 EARS-9). One canonical
 * implementation, imported by every host: a per-host copy would let the two
 * feeds' month rhythm drift apart (AGENTS.md cross-front reuse).
 */
const MSK_MONTH_KEY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: MSK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

export function mskMonthKey(isoInstant: string): string {
  return MSK_MONTH_KEY.format(new Date(isoInstant));
}

/**
 * The month-header label for a month-grouped feed — `«Июль 2026»`. `ru-RU`
 * yields `июль 2026 г.`; the trailing `г.` is dropped and the month capitalised
 * so the header matches the canvas band token.
 */
const MSK_MONTH_LABEL = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  month: "long",
  year: "numeric",
});

export function formatMskMonth(isoInstant: string): string {
  const label = MSK_MONTH_LABEL.format(new Date(isoInstant)).replace(
    /\s*г\.$/u,
    "",
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The day-header label for a listing group — `«16 июля, среда»` (date first,
 * weekday after), matching the §09 canvas rhythm. Computed in Europe/Moscow so
 * the grouping label agrees with {@link mskDayKey}.
 */
const MSK_WEEKDAY = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  weekday: "long",
});

export function formatMskDayLabel(isoInstant: string): string {
  const { date } = formatMskParts(isoInstant);
  return `${date}, ${MSK_WEEKDAY.format(new Date(isoInstant))}`;
}

/**
 * The abbreviated Moscow weekday (`ср`) for a listing card's day sub-label
 * (`16 июля · ср`, the §09 canvas time-plate). Computed in Europe/Moscow so it
 * agrees with {@link formatMskParts}; the `ru-RU` short form yields `ср.` — the
 * trailing period is stripped to match the canvas token.
 */
const MSK_WEEKDAY_SHORT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  weekday: "short",
});

export function formatMskWeekdayShort(isoInstant: string): string {
  return MSK_WEEKDAY_SHORT.format(new Date(isoInstant)).replace(/\.$/, "");
}
