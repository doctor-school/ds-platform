import { z } from "zod";

import { SlugSchema } from "../taxonomy/taxonomy.schema.js";
import { DoctorEventFormatSchema } from "./doctor-event-card.schema.js";
import {
  DoctorEventsFeedDaySchema,
  DoctorEventsFeedSpecialtyModeSchema,
  DoctorEventsFeedTargetingSchema,
  type DoctorEventsFeedQuery,
  parseDoctorEventsFeedQuery,
} from "./doctor-events-feed.schema.js";
import type { RawQueryValue } from "./event-listing-query.schema.js";
import { MonthBroadcastEntrySchema, YEAR_PARAM } from "./events.schema.js";

/**
 * 019 EARS-4 (#1519) — the `MonthGrid` read contract of
 * `GET /v1/storefront/doctor/events/month` (019-design §7, last line).
 *
 * ## One contract for the month view of the one events page
 *
 * The projection serves the month view of the one events page of
 * `@ds/events-storefront` (wave-2 gate rows 51, 53) and the compact month
 * beside its feed (row 56) — one contract, no second month read to keep in
 * step. The page builds its grid with `buildMonthGrid` from `entries`, the
 * same `MonthBroadcastEntry` list the Academy month read answers, so both hosts
 * pass one envelope (`EventsMonthEntriesReadSchema`) into one grid builder.
 * `days` stays the per-day projection: every day of the month is present,
 * `count: 0` included.
 *
 * ## The grid is navigation over the SAME targeted read
 *
 * The facet vocabulary is not re-declared here — it is the feed's, parsed by the
 * feed's codec ({@link parseDoctorEventsMonthQuery} delegates to
 * `parseDoctorEventsFeedQuery`). Only `month` is added. That is what makes the
 * grid's day counts equal the feed's day-group sizes for the same facets: the
 * two reads cannot disagree about what a facet means because they decode it
 * with one function.
 *
 * `tense`, `day`, `from` and `to` are deliberately absent. The horizon is the
 * whole МСК month, past days included (019 «Amendment — 2026-10-05»): a past
 * day counts its ended events, which the grid shows as muted pills.
 *
 * ## The two empty reasons stay distinct
 *
 * `targeting` is the SAME envelope field the feed carries, so the
 * `dataState` × surface matrix row «Month grid» renders «пусто по фасетам» and
 * «пусто по специальности» as the two different renders 019-design §3 requires
 * (LD-9): an empty month under `mode: "targeted"` with no adjacency rows is a
 * rare specialty, an empty month under any mode with facets applied is a facet
 * problem. No second discriminator vocabulary is invented for the grid.
 */

/** `YYYY-MM` — a calendar month in МСК. */
export const DoctorEventsMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected an ISO month (YYYY-MM)");

/**
 * The month query: the feed's facet subset plus `month`. `.strict()` guards the
 * shape of what the parser HANDS IN — a known key carrying an impossible value
 * is a 400 at the boundary, never a silently ignored narrowing the doctor
 * believes was applied. It is deliberately NOT a whole-URL allowlist:
 * `parseDoctorEventsMonthQuery` picks the seven keys it understands out of the
 * raw record first, so an unrelated query key (an analytics tag, a link
 * decoration) is dropped rather than refused. A browser URL carries traffic
 * this contract does not own, and 400-ing on it would break shareable links.
 */
export const DoctorEventsMonthQuerySchema = z
  .object({
    /** Defaults to the current МСК month, resolved server-side (the client owns no clock). */
    month: DoctorEventsMonthSchema.optional(),
    format: z.array(DoctorEventFormatSchema).default([]),
    kind: z.array(SlugSchema).default([]),
    specialty: z
      .union([
        DoctorEventsFeedSpecialtyModeSchema,
        z.array(z.string().min(1)).min(1),
      ])
      .default("mine-and-adjacent"),
    city: z.array(z.string().min(1)).default([]),
    nmo: z.boolean().optional(),
    free: z.boolean().optional(),
    q: z.string().min(1).optional(),
  })
  .strict();
export type DoctorEventsMonthQuery = z.infer<
  typeof DoctorEventsMonthQuerySchema
>;

/** One cell of the grid. `count` is the number of feed cards that fall on `date`. */
export const DoctorEventsMonthDaySchema = z
  .object({
    date: DoctorEventsFeedDaySchema,
    count: z.number().int().nonnegative(),
    /** The live marker of EARS-4 — the same lifecycle state the feed's card carries, never a start-time guess. */
    hasLive: z.boolean(),
  })
  .strict();
export type DoctorEventsMonthDay = z.infer<typeof DoctorEventsMonthDaySchema>;

export const DoctorEventsMonthGridSchema = z
  .object({
    month: DoctorEventsMonthSchema,
    /** «Сегодня» — the МСК calendar day, so the marker cannot drift with the reader's device clock. */
    today: DoctorEventsFeedDaySchema,
    /** EVERY day of `month`, ascending — the host fills nothing in. */
    days: z.array(DoctorEventsMonthDaySchema).min(28),
    /**
     * Wave-2 entry gate row 53 (PR 2.5) — the month's events behind `days`,
     * ascending by start: the pills of the package month grid (time · title,
     * the live pill, the muted past pill). The Academy month read's entry
     * shape, reused rather than forked; `days[].count` is the size of each
     * day's slice of this list.
     */
    entries: z.array(MonthBroadcastEntrySchema),
    /** The same envelope field the feed carries — see the file docblock. */
    targeting: DoctorEventsFeedTargetingSchema,
  })
  .strict();
export type DoctorEventsMonthGrid = z.infer<typeof DoctorEventsMonthGridSchema>;

/**
 * Wave-2 entry gate row 54 (PR 2.5) — the doctor per-month counts read, the
 * counterpart of the Academy `GET /v1/public/events/month-counts`: the same
 * `year` (`YYYY`) and the same facets as the month read. Its answer is the
 * Academy's `MonthlyEventCount[]` (12 dense rows), reused, not forked.
 */
export const DoctorEventsMonthCountsQuerySchema =
  DoctorEventsMonthQuerySchema.omit({ month: true })
    .extend({ year: z.string().regex(YEAR_PARAM, "expected a year (YYYY)") })
    .strict();
export type DoctorEventsMonthCountsQuery = z.infer<
  typeof DoctorEventsMonthCountsQuerySchema
>;

/** The counts codec: the month codec's facet half plus the year — no fork. */
export function parseDoctorEventsMonthCountsQuery(
  raw: Record<string, RawQueryValue>,
): z.ZodSafeParseResult<DoctorEventsMonthCountsQuery> {
  const facets = parseDoctorEventsMonthQuery({ ...raw, month: undefined });
  if (!facets.success) {
    return facets as unknown as z.ZodSafeParseResult<DoctorEventsMonthCountsQuery>;
  }
  const year = Array.isArray(raw.year) ? raw.year[0] : raw.year;
  return DoctorEventsMonthCountsQuerySchema.safeParse({
    ...doctorEventsMonthFacets(facets.data),
    year,
  });
}

/**
 * The month query codec. The facet half is DELEGATED to the feed's codec — the
 * repeatable-parameter and `RawQueryValue` handling exists once, in
 * `parseDoctorEventsFeedQuery`, and a fork of it here would be the EARS-15
 * «second listing engine» failure in its cheapest form.
 */
export function parseDoctorEventsMonthQuery(
  raw: Record<string, RawQueryValue>,
): z.ZodSafeParseResult<DoctorEventsMonthQuery> {
  const facets = parseDoctorEventsFeedQuery({
    format: raw.format,
    kind: raw.kind,
    specialty: raw.specialty,
    city: raw.city,
    nmo: raw.nmo,
    free: raw.free,
    q: raw.q,
  });
  // A malformed facet is the feed's own 400, reported with the feed's issue
  // paths — the shapes differ only in the absent `month` key, so re-wrapping the
  // error would only rename the same problem.
  if (!facets.success) {
    return facets as unknown as z.ZodSafeParseResult<DoctorEventsMonthQuery>;
  }

  const month = Array.isArray(raw.month) ? raw.month[0] : raw.month;

  return DoctorEventsMonthQuerySchema.safeParse({
    month: month === undefined || month.length === 0 ? undefined : month,
    format: facets.data.format,
    kind: facets.data.kind,
    specialty: facets.data.specialty,
    city: facets.data.city,
    nmo: facets.data.nmo,
    free: facets.data.free,
    q: facets.data.q,
  });
}

/** The facet half of a month query, in the shape the feed's own read takes. */
export function doctorEventsMonthFacets(
  query: DoctorEventsMonthQuery,
): Pick<
  DoctorEventsFeedQuery,
  "format" | "kind" | "specialty" | "city" | "nmo" | "free" | "q"
> {
  return {
    format: query.format,
    kind: query.kind,
    specialty: query.specialty,
    city: query.city,
    nmo: query.nmo,
    free: query.free,
    q: query.q,
  };
}

/** The МСК month an ISO day falls in. */
export function doctorEventsMonthOf(day: string): string {
  return day.slice(0, 7);
}

/** The first ISO day of a month. */
export function doctorEventsMonthFirstDay(month: string): string {
  return `${month}-01`;
}

/** The first ISO day of the FOLLOWING month — the exclusive upper bound of the read. */
export function doctorEventsMonthNextFirstDay(month: string): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return index === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

/** Every ISO day of the month, ascending — the skeleton `days` is built on. */
export function doctorEventsMonthDayList(month: string): string[] {
  const days: string[] = [];
  const end = doctorEventsMonthNextFirstDay(month);
  let cursor = doctorEventsMonthFirstDay(month);
  while (cursor < end) {
    days.push(cursor);
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return days;
}
