import {
  instantToMskDay,
  lastDayOfClosingInstant,
  mskClosingInstantAfterLastDay,
} from "./congress-intake-settings.schema.js";

/**
 * 046 EARS-34 — the term of a revision request: three business days. A product
 * constant of the spec, not a setting; no intake setting applies to it.
 */
export const CONGRESS_REVISION_BUSINESS_DAYS = 3;

/** One calendar day after `day` (`YYYY-MM-DD`), on the calendar alone. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Monday to Friday, with no holiday calendar (EARS-34). */
function isBusinessDay(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * 046 EARS-34 — the revision deadline a status change to `needs_revision` at
 * `changedAt` sets: the end (23:59:59 Moscow) of the third business day after
 * the Moscow day of the change, stored as 00:00 Moscow of the following day.
 * The day of the change is not counted; business days are Monday to Friday.
 *
 * The ONE function the API (the status route), the section and the letter
 * share — none of them computes the term on its own.
 */
export function revisionDueAt(changedAt: Date): Date {
  let day = instantToMskDay(changedAt);
  let counted = 0;
  while (counted < CONGRESS_REVISION_BUSINESS_DAYS) {
    day = nextDay(day);
    if (isBusinessDay(day)) counted += 1;
  }
  return mskClosingInstantAfterLastDay(day);
}

/**
 * 046 EARS-35 — the stored instant of an extended deadline whose new last day
 * is the Moscow calendar date `lastDay`: 00:00 Moscow of the following day.
 */
export function revisionExtensionDueAt(lastDay: string): Date {
  return mskClosingInstantAfterLastDay(lastDay);
}

/**
 * The last day (Moscow, inclusive) a stored revision deadline keeps open — the
 * day before the stored instant; the «{дата}» of «до {дата}, 23:59 МСК».
 */
export function revisionLastDay(revisionDueAt: Date): string {
  return lastDayOfClosingInstant(revisionDueAt);
}
