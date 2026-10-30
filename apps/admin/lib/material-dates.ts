/**
 * 048 EARS-4 / EARS-7 — the first-publication date as the admin shows it: the
 * calendar day in МСК (the platform's wall clock), in the `ДД.ММ.ГГГГ` form of
 * the other admin lists. An instant just after midnight МСК is that МСК day,
 * not the UTC one the ISO string spells.
 */
const MSK_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatMaterialDate(isoInstant: string): string {
  return MSK_DATE.format(new Date(isoInstant));
}
