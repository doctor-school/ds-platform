import type { EventParticipationFormat } from "./participation.schema.js";

/**
 * The one event-time formatter of the platform — 004 EARS-12 as amended
 * 2026-10-02 (mechanism: 004-design §6.1; registry row «Event time formatter»).
 *
 * The read model stores one canonical UTC instant. An `online` or `hybrid`
 * event is presented in the viewer's IANA zone; an `offline` event in
 * `Europe/Moscow` for every viewer. The zone label is always explicit: «МСК»
 * when the shown offset is +03:00, otherwise «GMT±N» / «GMT±N:MM» («GMT+0» at
 * zero). Grouping keys (`groupDay`, `groupMonth`) are the day and month of the
 * time SHOWN, so a mixed list groups each event under the day its card reads.
 *
 * Pure and React-free on purpose: `apps/api` (emails) and `apps/admin` cannot
 * depend on the React storefront package, so they import it from here with
 * `viewerZone: MOSCOW_TIME_ZONE`; `@ds/events-storefront` re-exports it for the
 * storefronts and adds only the React side (`useViewerZone`).
 */

export const MOSCOW_TIME_ZONE = "Europe/Moscow";

export interface EventTimeInput {
  /** The canonical instant — an ISO string from the read model or a `Date`. */
  startsAt: string | Date;
  /**
   * The event's participation format. `offline` pins the presentation to
   * `Europe/Moscow` whatever `viewerZone` says. Omitted by the callers that
   * present every event in the zone they pass by rule (the admin, emails and
   * SMS — all `Europe/Moscow`), where the format cannot change the zone.
   */
  participationFormat?: EventParticipationFormat;
  /** The viewer's IANA zone (`useViewerZone()` on a storefront). */
  viewerZone: string;
}

export interface EventTime {
  /** «16 июля» */
  date: string;
  /** «16 июля 2026 г.» — the admin's and the mail's absolute date. */
  dateWithYear: string;
  /** «19:00» (24-hour). */
  time: string;
  /** «четверг» */
  weekday: string;
  /** «чт» — the short weekday, never with a trailing period. */
  weekdayShort: string;
  /** «Июль 2026» — a month-group header. */
  monthLabel: string;
  /** «МСК», «GMT+5», «GMT+5:30», «GMT-4», «GMT+0». */
  zoneLabel: string;
  /** `YYYY-MM-DD` of the shown time — the day-grouping key. */
  groupDay: string;
  /** `YYYY-MM` of the shown time — the month-grouping key. */
  groupMonth: string;
}

interface ZoneFormats {
  date: Intl.DateTimeFormat;
  dateWithYear: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  weekdayShort: Intl.DateTimeFormat;
  monthLabel: Intl.DateTimeFormat;
  dayKey: Intl.DateTimeFormat;
  offset: Intl.DateTimeFormat;
}

/** One set of formatters per zone — a listing formats many instants in one zone. */
const FORMATS = new Map<string, ZoneFormats>();

function formatsFor(timeZone: string): ZoneFormats {
  const cached = FORMATS.get(timeZone);
  if (cached) return cached;
  const formats: ZoneFormats = {
    date: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "numeric",
      month: "long",
    }),
    dateWithYear: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    time: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    weekday: new Intl.DateTimeFormat("ru-RU", { timeZone, weekday: "long" }),
    weekdayShort: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      weekday: "short",
    }),
    monthLabel: new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      month: "long",
      year: "numeric",
    }),
    // `en-CA` yields the ISO-ordered `YYYY-MM-DD` directly.
    dayKey: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    offset: new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }),
  };
  FORMATS.set(timeZone, formats);
  return formats;
}

/** «GMT+05:30» → «GMT+5:30»; «+03:00» → «МСК»; «GMT» (zero) → «GMT+0». */
function zoneLabelOf(offsetFormat: Intl.DateTimeFormat, instant: Date): string {
  const name =
    offsetFormat
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(name);
  if (!match) return "GMT+0";
  const [, sign, hh, mm] = match as unknown as [string, string, string, string];
  if (sign === "+" && hh === "03" && mm === "00") return "МСК";
  const hours = Number(hh);
  if (hours === 0 && mm === "00") return "GMT+0";
  return mm === "00" ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${mm}`;
}

export function formatEventTime(input: EventTimeInput): EventTime {
  const timeZone =
    input.participationFormat === "offline"
      ? MOSCOW_TIME_ZONE
      : input.viewerZone;
  const instant =
    input.startsAt instanceof Date ? input.startsAt : new Date(input.startsAt);
  const f = formatsFor(timeZone);
  const monthLabel = f.monthLabel.format(instant).replace(/\s*г\.$/u, "");
  const groupDay = f.dayKey.format(instant);
  return {
    date: f.date.format(instant),
    dateWithYear: f.dateWithYear.format(instant),
    time: f.time.format(instant),
    weekday: f.weekday.format(instant),
    // Some ICU builds emit the ru-RU short weekday with a trailing period.
    weekdayShort: f.weekdayShort.format(instant).replace(/\.$/u, ""),
    monthLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
    zoneLabel: zoneLabelOf(f.offset, instant),
    groupDay,
    groupMonth: groupDay.slice(0, 7),
  };
}
