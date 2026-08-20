/**
 * Shared wall-clock helpers for e2e suites.
 *
 * Wall-clock date literals in a suite rot: the day a pinned `YYYY-MM-DD`
 * drifts into the past, every assertion that assumed a FUTURE instant
 * (published events on the 004 upcoming listing, which filters by
 * `starts_at ≥ now() − airWindow`, 007 design §4) silently turns red with no
 * production change behind it. Derive the instant relative to `now` instead.
 */

/**
 * A future MSK wall-clock start in the `YYYY-MM-DDTHH:mm` shape the 007
 * admin-create input expects, `daysAhead` days from now.
 */
export function futureMskStart(daysAhead: number, hhmm: string): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
  }).format(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));
  return `${day}T${hhmm}`;
}
