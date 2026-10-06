import { MOSCOW_TIME_ZONE, MSK_UTC_OFFSET, formatEventTime } from "@ds/schemas";

/**
 * Canonical Moscow-time handling for the admin surface (007 EARS-10, design §3).
 * The admin enters and reads every event time in `Europe/Moscow` (004 EARS-12
 * as amended — «Admin entry»), so the read side is the one event-time formatter
 * (`formatEventTime`, `@ds/schemas`) pinned to Moscow; the output is identical
 * regardless of the browser's locale/TZ (a Playwright `timezoneId` override
 * asserts no drift). The visible «МСК» label is copy — it lives in the message
 * catalog, not here.
 */
const MSK_TIME_ZONE = MOSCOW_TIME_ZONE;

/** Full absolute label — `17 июля 2026 г., 19:00` — for the list/detail air time. */
export function formatMskDateTime(isoInstant: string): string {
  const { dateWithYear, time } = formatEventTime({
    startsAt: isoInstant,
    viewerZone: MOSCOW_TIME_ZONE,
  });
  return `${dateWithYear}, ${time}`;
}

/**
 * Fold a canonical UTC instant back into the naive МСК wall-clock string
 * (`YYYY-MM-DDTHH:mm`) a `datetime-local` input expects — the inverse of
 * {@link mskLocalToInstant} — so the edit form pre-fills with the operator's
 * original МСК entry, never the browser-local rendering. Computed by reading the
 * instant's parts IN `Europe/Moscow` (fixed UTC+3, no DST since 2014), so it is
 * stable across the operator's timezone.
 */
export function instantToMskInput(isoInstant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MSK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoInstant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** The fixed МСК offset the write path folds a wall-clock entry with (re-exported SSOT). */
export { MSK_UTC_OFFSET };
