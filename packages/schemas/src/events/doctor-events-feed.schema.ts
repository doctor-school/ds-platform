import { z } from "zod";

import { SlugSchema } from "../taxonomy/taxonomy.schema.js";
import {
  DoctorEventCardSchema,
  DoctorEventFormatSchema,
} from "./doctor-event-card.schema.js";
import { PublicEventFacetOptionSchema } from "./event-facet-option.schema.js";
import { MOSCOW_TIME_ZONE, formatEventTime } from "./event-time.js";
import {
  createEventListingQueryCodec,
  type EventListingQueryEntry,
  type EventListingQueryField,
  type RawQueryRecord,
} from "./event-listing-query.schema.js";

/**
 * 019 EARS-3 (#1518) — the day-grouped, specialty-targeted feed contract of
 * `GET /v1/storefront/doctor/events`, plus the ONE query codec both the API
 * controller and the `apps/doctor` route read (019-design §3, §7).
 *
 * Two invariants are expressed as types rather than as review etiquette:
 *
 * 1. **No ranking.** Every object here is `.strict()`, so a `score`, `rank`,
 *    `relevance` or `personalised` field added upstream is REJECTED at the
 *    boundary instead of being forwarded to the client. 019's order is the
 *    chronological order of the day groups and nothing else.
 * 2. **Targeting is a managed traversal, never a likeness.** `targeting`
 *    reports the direction ids the read was restricted to — resolved by 017's
 *    `TargetingService` over the managed rows (#1484) and 018's adjacency
 *    edges (#1483). A specialty with no adjacency rows therefore yields an
 *    EMPTY `adjacentDirectionIds`, and the feed carries only its own events;
 *    there is no name-similarity path into this contract at all.
 *
 * The horizon (`from`/`to`) is the LD-2 bounded window: «показать ещё» widens
 * `to` in the URL, so the feed stays a pure function of its URL (EARS-8) and
 * no client-local paging engine exists.
 */

/**
 * The calendar years a doctor events read serves — `day`/`from`/`to`, `month`
 * and the counts `year` alike (#2831). A well-shaped value outside them (or an
 * impossible day such as `2026-02-31`) is a 400 at the boundary: the horizon
 * and month arithmetic downstream would otherwise roll into an Invalid Date or
 * a year past 9999 and answer 500 (019 EARS-8.17).
 */
export const DOCTOR_EVENTS_QUERY_YEAR_MIN = 1900;
export const DOCTOR_EVENTS_QUERY_YEAR_MAX = 2999;

/** Whether a calendar year lies in the served range. */
export function isDoctorEventsQueryYear(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= DOCTOR_EVENTS_QUERY_YEAR_MIN &&
    year <= DOCTOR_EVENTS_QUERY_YEAR_MAX
  );
}

/**
 * The `YYYY-MM-DD` SHAPE alone. The events PAGE URL keeps it — a page whose
 * `from` is a refused day still renders, and the feed block alone reports the
 * read's 400 (019 EARS-9, #1530) — and so does every RESPONSE day: a horizon
 * the api resolves one day past a served edge (`to` after
 * `from=2999-12-31`, `from` before `to=1900-01-01`) is an honest echo, so the
 * refusal stays at the request boundary. Every read REQUEST parses
 * {@link DoctorEventsFeedDaySchema}.
 */
export const DoctorEventsFeedDayShapeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO calendar day (YYYY-MM-DD)");

/** Whether a well-shaped ISO day is a real calendar day in the served years. */
function isServedCalendarDay(day: string): boolean {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  if (!isDoctorEventsQueryYear(year)) return false;
  const parsed = new Date(Date.UTC(year, month - 1, date));
  // Round-trip: `2026-02-31` rolls into March, so it does not come back equal.
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
  );
}

/** `YYYY-MM-DD` — a calendar day in МСК, the unit both the horizon and the grouping use. */
export const DoctorEventsFeedDaySchema = DoctorEventsFeedDayShapeSchema.refine(
  isServedCalendarDay,
  "expected a real calendar day within the served years",
);

export const DoctorEventsFeedTenseSchema = z.enum(["upcoming", "past"]);
export type DoctorEventsFeedTense = z.infer<typeof DoctorEventsFeedTenseSchema>;

/** `specialty` takes a mode or an explicit list of specialty references (019-design §7). */
export const DoctorEventsFeedSpecialtyModeSchema = z.enum([
  "mine-and-adjacent",
  "all",
]);
export type DoctorEventsFeedSpecialtyMode = z.infer<
  typeof DoctorEventsFeedSpecialtyModeSchema
>;

/**
 * «Будущие»: the default horizon width and the step «показать ещё» adds to it,
 * in days.
 */
export const DOCTOR_EVENTS_FEED_HORIZON_DAYS = 14;
export const DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS = 14;
/**
 * «Прошедшие» pages by COUNT, not by days (019 LD-2, «Amendment — 2026-10-12»):
 * the default screen is this many most recent past events and every
 * «показать ещё» adds this many older ones (the last step the remainder). The
 * extent stays `from`/`to` in whole МСК days, so a day the step's last event
 * falls on is shown whole.
 */
export const DOCTOR_EVENTS_FEED_PAST_STEP_EVENTS = 10;
/**
 * The widest horizon a single read will serve; a wider `to` within the served
 * years is clamped, not rejected. A `to` outside them
 * ({@link DOCTOR_EVENTS_QUERY_YEAR_MIN}–{@link DOCTOR_EVENTS_QUERY_YEAR_MAX})
 * is a 400 (019 EARS-8.17).
 */
export const DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS = 365;

export const DoctorEventsFeedQuerySchema = z
  .object({
    /** The day the feed body is scrolled to (EARS-4). Never narrows the read. */
    day: DoctorEventsFeedDaySchema.optional(),
    tense: DoctorEventsFeedTenseSchema.default("upcoming"),
    from: DoctorEventsFeedDaySchema.optional(),
    to: DoctorEventsFeedDaySchema.optional(),
    format: z.array(DoctorEventFormatSchema).default([]),
    /**
     * The `kind` FACET is a list of 012 event-kind dictionary SLUGS — the
     * same value the card's `kind.slug` carries, so a card value round-trips
     * (019 «Amendment — 2026-10-01»). The slug grammar is enforced here, so a
     * malformed value is a 400 at the boundary, never a database error.
     */
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
export type DoctorEventsFeedQuery = z.infer<typeof DoctorEventsFeedQuerySchema>;

/** One day heading with the events that fall under it. A day with no events is not emitted. */
export const DoctorEventDayGroupSchema = z
  .object({
    day: DoctorEventsFeedDayShapeSchema,
    /** Pre-formatted Russian heading — one rendering rule for every host. */
    label: z.string().min(1),
    items: z.array(DoctorEventCardSchema).min(1),
  })
  .strict();
export type DoctorEventDayGroup = z.infer<typeof DoctorEventDayGroupSchema>;

/**
 * What the read was targeted on. Reported so a consumer can state the applied
 * targeting honestly (EARS-9) — it is NOT a ranking input and carries no score.
 */
export const DoctorEventsFeedTargetingSchema = z
  .object({
    /** `targeted` — a managed specialty→direction chain; `general` — the «Другое» fallback; `all` — targeting off by request. */
    mode: z.enum(["targeted", "general", "all"]),
    specialtyReference: z.string().nullable(),
    directionIds: z.array(z.string()),
    /** Empty exactly when the specialty has no active adjacency rows (@EARS-3 @failure). */
    adjacentDirectionIds: z.array(z.string()),
  })
  .strict();
export type DoctorEventsFeedTargeting = z.infer<
  typeof DoctorEventsFeedTargetingSchema
>;

/**
 * The doctor facet panel's options beside a feed page (wave-2 gate §4.3 D9) —
 * the Academy's option block mirrored: the same item shape, counted under the
 * OTHER facets' current selection over the tense's reachable range, ordered
 * by title then slug, a zero-yield option kept. `kind` is the 012 kind
 * dictionary (slug + title); `city` the value a card's `city` carries (a city
 * name, hence not slug grammar). `format` and `specialty` need no block — the
 * format set is fixed and specialties come from `/v1/public/specialties`.
 */
export const DoctorEventFacetOptionsSchema = z
  .object({
    city: z.array(
      PublicEventFacetOptionSchema.extend({ slug: z.string().min(1) }),
    ),
    kind: z.array(PublicEventFacetOptionSchema),
  })
  .strict();
export type DoctorEventFacetOptions = z.infer<
  typeof DoctorEventFacetOptionsSchema
>;

export const DoctorEventsFeedSchema = z
  .object({
    tense: DoctorEventsFeedTenseSchema,
    /**
     * Wave-2 gate §4.3 D10 — the api's «сегодня», the codec-zone (МСК)
     * calendar day the read resolved its horizon against; the month read's
     * `today` field. The page takes its one today from here (month grid,
     * «Сегодня», the day-href tense boundary), never from the device clock or
     * the URL-echoed extent.
     */
    today: DoctorEventsFeedDayShapeSchema,
    /** The applied horizon, echoed so the client never has to re-derive it. */
    from: DoctorEventsFeedDayShapeSchema,
    to: DoctorEventsFeedDayShapeSchema,
    days: z.array(DoctorEventDayGroupSchema),
    totalCount: z.number().int().nonnegative(),
    /**
     * «Будущие»: the `to` «показать ещё» writes into the URL; `null` when
     * nothing lies past the window or the horizon is already maximal. Always
     * `null` on «Прошедшие», whose extent widens backward ({@link nextFrom}).
     */
    nextTo: DoctorEventsFeedDayShapeSchema.nullable(),
    /**
     * «Прошедшие»: the older `from` «показать ещё» writes into the URL; `null`
     * when nothing older lies within the widest horizon. Always `null` on
     * «Будущие». One codec: the past extent moves its `from`, the upcoming
     * extent its `to` — the same two URL keys.
     */
    nextFrom: DoctorEventsFeedDayShapeSchema.nullable(),
    /**
     * The matching events beyond the current extent that further «показать
     * ещё» steps can still reach (within the widest horizon) — the M of
     * «Показать ещё N из M»; `0` exactly when both next bounds are `null`.
     */
    remaining: z.number().int().nonnegative(),
    /**
     * The matching events the NEXT «показать ещё» step adds — the events in
     * `[to, nextTo)` on «Будущие», `[nextFrom, from)` on «Прошедшие» — the N
     * of «Показать ещё N из M»; `0` exactly when both next bounds are `null`.
     */
    nextBatch: z.number().int().nonnegative(),
    targeting: DoctorEventsFeedTargetingSchema,
    /** The facet panel's options (D9); additive — an older reader ignores it. */
    facets: DoctorEventFacetOptionsSchema.optional(),
  })
  .strict();
export type DoctorEventsFeed = z.infer<typeof DoctorEventsFeedSchema>;

/**
 * The doctor host's mount of the PORTABLE codec (019-design §8 step 3, #1523).
 *
 * The grammar — repeatable-parameter spelling, boolean spelling, drop-unknown,
 * the deterministic key order — lives in `event-listing-query.schema.ts` and is
 * shared. What stays HERE is only this host's vocabulary and defaults: which
 * keys exist, what each takes, and that a missing `tense` means `upcoming` and
 * a missing `specialty` means `mine-and-adjacent`. The field table below is
 * ordered, and that order IS the URL's key order.
 */
/** The doctor codec's field table — its order IS the URL's key order. */
export const DOCTOR_EVENTS_FEED_QUERY_FIELDS = [
    { key: "day", kind: "scalar" },
    { key: "tense", kind: "scalar" },
    { key: "from", kind: "scalar" },
    { key: "to", kind: "scalar" },
    { key: "format", kind: "list" },
    { key: "kind", kind: "list" },
    {
      key: "specialty",
      kind: "mode-or-list",
      modes: DoctorEventsFeedSpecialtyModeSchema.options,
    },
    { key: "city", kind: "list" },
    { key: "nmo", kind: "boolean" },
    { key: "free", kind: "boolean" },
    { key: "q", kind: "scalar" },
  ] as const satisfies readonly EventListingQueryField[];

export const DOCTOR_EVENTS_FEED_QUERY_CODEC = createEventListingQueryCodec({
  schema: DoctorEventsFeedQuerySchema,
  fields: DOCTOR_EVENTS_FEED_QUERY_FIELDS,
});

/**
 * The single query codec of 019 (019-design §3). The API controller and the
 * `apps/doctor` route both call THIS — an app-local re-parse would be the
 * EARS-15 «second listing engine» failure in its cheapest form.
 */
export function parseDoctorEventsFeedQuery(
  raw: RawQueryRecord,
): z.ZodSafeParseResult<DoctorEventsFeedQuery> {
  return DOCTOR_EVENTS_FEED_QUERY_CODEC.parse(raw);
}

/**
 * The other half of the same round-trip (EARS-8): re-encode exactly what the
 * codec understood, as ordered wire entries (a host turns them into its own
 * `URLSearchParams` — this package stays platform-free). Anything it did not understand is DROPPED rather than
 * forwarded, so a hand-edited URL can never smuggle an unknown parameter into
 * the api read — and every host link is written by this one serialiser.
 */
export function encodeDoctorEventsFeedQueryEntries(
  raw: RawQueryRecord,
): EventListingQueryEntry[] {
  return DOCTOR_EVENTS_FEED_QUERY_CODEC.reencode(raw);
}

/**
 * The МСК calendar day an instant falls on — the grouping key of the feed. The
 * day comes from the one event-time formatter (004 EARS-12), pinned to Moscow.
 */
export function doctorEventsFeedDayOf(instant: Date): string {
  return formatEventTime({ startsAt: instant, viewerZone: MOSCOW_TIME_ZONE })
    .groupDay;
}

/** «12 сентября, пятница» — the one day-heading rendering rule for every host. */
export function formatDoctorEventsFeedDayLabel(day: string): string {
  // Midday UTC of the key is the same calendar day in Moscow.
  const { date, weekday } = formatEventTime({
    startsAt: `${day}T12:00:00Z`,
    viewerZone: MOSCOW_TIME_ZONE,
  });
  return `${date}, ${weekday}`;
}

/** Add `days` calendar days to an ISO day, staying in the `YYYY-MM-DD` space. */
export function addDoctorEventsFeedDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Whole calendar days between two ISO days (`to - from`). */
export function doctorEventsFeedHorizonWidth(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00Z`).getTime() -
    new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}
