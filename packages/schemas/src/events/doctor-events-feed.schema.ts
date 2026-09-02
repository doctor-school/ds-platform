import { z } from "zod";
import { DoctorEventCardSchema, DoctorEventFormatSchema } from "./doctor-event-card.schema.js";

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

/** `YYYY-MM-DD` — a calendar day in МСК, the unit both the horizon and the grouping use. */
export const DoctorEventsFeedDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO calendar day (YYYY-MM-DD)");

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

/** The default horizon width and the step «показать ещё» adds to it, in days. */
export const DOCTOR_EVENTS_FEED_HORIZON_DAYS = 14;
export const DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS = 14;
/** The widest horizon a single read will serve; a wider `to` is clamped, never rejected. */
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
     * The `kind` FACET is a list of managed direction IDs — the same vocabulary
     * the card's own `kind` field carries, so a card value round-trips. The
     * uuid constraint is load-bearing, not cosmetic: `direction_id` is a uuid
     * column, so an unconstrained value would reach Postgres and raise `22P02`
     * as a 500 on a public unauthenticated URL. A malformed `kind` is a 400 at
     * the boundary instead.
     */
    kind: z.array(z.uuid()).default([]),
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
    day: DoctorEventsFeedDaySchema,
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

export const DoctorEventsFeedSchema = z
  .object({
    tense: DoctorEventsFeedTenseSchema,
    /** The applied horizon, echoed so the client never has to re-derive it. */
    from: DoctorEventsFeedDaySchema,
    to: DoctorEventsFeedDaySchema,
    days: z.array(DoctorEventDayGroupSchema),
    totalCount: z.number().int().nonnegative(),
    /** The `to` «показать ещё» writes into the URL; `null` when the horizon is already maximal. */
    nextTo: DoctorEventsFeedDaySchema.nullable(),
    targeting: DoctorEventsFeedTargetingSchema,
  })
  .strict();
export type DoctorEventsFeed = z.infer<typeof DoctorEventsFeedSchema>;

/** A raw querystring value as Fastify / Next.js hand it over. */
export type RawQueryValue = string | string[] | undefined;

const asList = (value: RawQueryValue): string[] | undefined => {
  if (value === undefined) return undefined;
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : undefined;
};

const asBoolean = (value: RawQueryValue): boolean | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return undefined;
  if (first === "true" || first === "1") return true;
  if (first === "false" || first === "0") return false;
  return undefined;
};

const asScalar = (value: RawQueryValue): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.length === 0 ? undefined : first;
};

/**
 * The single query codec of 019 (019-design §3). The API controller and the
 * `apps/doctor` route both call THIS — an app-local re-parse would be the
 * EARS-15 «second listing engine» failure in its cheapest form.
 */
export function parseDoctorEventsFeedQuery(
  raw: Record<string, RawQueryValue>,
): z.ZodSafeParseResult<DoctorEventsFeedQuery> {
  const specialtyRaw = asList(raw.specialty);
  const specialty =
    specialtyRaw === undefined
      ? undefined
      : specialtyRaw.length === 1 &&
          DoctorEventsFeedSpecialtyModeSchema.safeParse(specialtyRaw[0]).success
        ? specialtyRaw[0]
        : specialtyRaw;

  return DoctorEventsFeedQuerySchema.safeParse({
    day: asScalar(raw.day),
    tense: asScalar(raw.tense),
    from: asScalar(raw.from),
    to: asScalar(raw.to),
    format: asList(raw.format),
    kind: asList(raw.kind),
    specialty,
    city: asList(raw.city),
    nmo: asBoolean(raw.nmo),
    free: asBoolean(raw.free),
    q: asScalar(raw.q),
  });
}

const MOSCOW_TIME_ZONE = "Europe/Moscow";

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MOSCOW_TIME_ZONE,
  day: "numeric",
  month: "long",
  weekday: "long",
});

/** The МСК calendar day an instant falls on — the grouping key of the feed. */
export function doctorEventsFeedDayOf(instant: Date): string {
  // `en-CA` yields `YYYY-MM-DD`, so the key needs no manual padding.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** «12 сентября, пятница» — the one day-heading rendering rule for every host. */
export function formatDoctorEventsFeedDayLabel(day: string): string {
  const parts = DAY_LABEL_FORMAT.formatToParts(new Date(`${day}T12:00:00Z`));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")} ${value("month")}, ${value("weekday")}`;
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
    new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}
