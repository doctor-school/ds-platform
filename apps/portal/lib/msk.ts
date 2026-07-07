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
