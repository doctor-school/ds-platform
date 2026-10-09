import { z } from "zod";
import { RecordingProjectionSchema } from "../recordings/recordings.schema.js";
import { SlugSchema } from "../taxonomy/taxonomy.schema.js";
import { DoctorEventsFeedDaySchema } from "./doctor-events-feed.schema.js";
import { PublicEventFacetOptionSchema } from "./event-facet-option.schema.js";
import {
  createEventListingQueryCodec,
  type RawQueryRecord,
} from "./event-listing-query.schema.js";
import { UpcomingBroadcastCardSchema } from "./events.schema.js";

/**
 * 014 EARS-12 (wave-2 entry gate §4.2, PR 2.5) — the Academy facets Проект,
 * Эксперт, Тема. Each is a list of 012 taxonomy SLUGS — `project` a project,
 * `expert` an expert, `topic` a direction (012's topics book, renamed by
 * ADR-0016 §5) — the same reference kind the doctor `kind` facet carries.
 * Values of one facet OR together, the facets AND together (014-design §9). A
 * malformed slug is a 400 at the boundary; a well-formed slug nothing carries
 * reads an empty set, never an error — the doctor `kind` facet's behaviour.
 */
const AcademyEventFacetsShape = {
  project: z.array(SlugSchema).default([]),
  expert: z.array(SlugSchema).default([]),
  topic: z.array(SlugSchema).default([]),
};

export const AcademyEventFacetsSchema = z
  .object(AcademyEventFacetsShape)
  .strict();
export type AcademyEventFacets = z.infer<typeof AcademyEventFacetsSchema>;

/**
 * The Academy mount of the PORTABLE codec — the doctor facets' grammar
 * (`event-listing-query.schema.ts`: repeated or comma form, unknown keys
 * dropped, fixed key order) over the Academy vocabulary. One codec, two facet
 * sets: the listing, the month read and the month counts all decode their
 * facets through THIS, so the month view and the feed read the same set.
 */
export const ACADEMY_EVENT_FACETS_QUERY_CODEC = createEventListingQueryCodec({
  schema: AcademyEventFacetsSchema,
  fields: [
    { key: "project", kind: "list" },
    { key: "expert", kind: "list" },
    { key: "topic", kind: "list" },
  ],
} as const);

export function parseAcademyEventFacets(
  raw: RawQueryRecord,
): z.ZodSafeParseResult<AcademyEventFacets> {
  return ACADEMY_EVENT_FACETS_QUERY_CODEC.parse(raw);
}

/** `true` when any Academy facet narrows the read. */
export function hasAcademyEventFacets(facets: AcademyEventFacets): boolean {
  return (
    facets.project.length > 0 ||
    facets.expert.length > 0 ||
    facets.topic.length > 0
  );
}

export const PublicEventFacetOptionsSchema = z
  .object({
    project: z.array(PublicEventFacetOptionSchema),
    expert: z.array(PublicEventFacetOptionSchema),
    topic: z.array(PublicEventFacetOptionSchema),
  })
  .strict();
export type PublicEventFacetOptions = z.infer<
  typeof PublicEventFacetOptionsSchema
>;

/** 014 EARS-11 selector; the legacy no-query/upcoming array remains stable. */
export const EventListingTimeframeSchema = z.enum(["upcoming", "past"]);
export type EventListingTimeframe = z.infer<typeof EventListingTimeframeSchema>;

/**
 * Two paging modes off one read. The horizon (`from`, `to`) is the one codec's
 * bounded window (wave-2 entry gate §4.3 D2): «Показать ещё» widens `to` in the
 * URL, exactly as on the doctor feed, so the extent is URL state (019 LD-1,
 * LD-2). The keyset `cursor` stays accepted for other callers. The two never
 * combine — a horizon page has no cursor, and a cursor page no horizon.
 */
export const PublicEventListingQuerySchema = z
  .object({
    timeframe: EventListingTimeframeSchema,
    /**
     * The cursor page's size. A read stating neither `limit` nor `cursor` is the
     * horizon read of the tense's default extent (D2, row 32) — the bare
     * `/webinars` and `?tense=past` — so the size has no default here; the
     * cursor page applies its own.
     */
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(512).optional(),
    from: DoctorEventsFeedDaySchema.optional(),
    to: DoctorEventsFeedDaySchema.optional(),
    ...AcademyEventFacetsShape,
  })
  .refine(
    (query) =>
      query.cursor === undefined ||
      (query.from === undefined && query.to === undefined),
    { message: "a cursor and a horizon (from, to) never combine" },
  );
export type PublicEventListingQuery = z.infer<
  typeof PublicEventListingQuerySchema
>;

export const PastBroadcastCardSchema = UpcomingBroadcastCardSchema.omit({
  state: true,
})
  .extend({ state: z.literal("ended"), recording: RecordingProjectionSchema })
  .strict();
export type PastBroadcastCard = z.infer<typeof PastBroadcastCardSchema>;

export const PublicEventListingCountsSchema = z.object({
  upcoming: z.number().int().nonnegative(),
  past: z.number().int().nonnegative(),
  /**
   * Distinct schools among the upcoming listing-eligible events — the «M школ»
   * half of the Academy feed subline «N эфиров · M школ» (019 / wave-2 gate
   * §2.4 row 19).
   */
  upcomingSchools: z.number().int().nonnegative(),
});
export type PublicEventListingCounts = z.infer<
  typeof PublicEventListingCountsSchema
>;

export const PublicEventListingPageSchema = z.object({
  data: z.array(
    z.union([UpcomingBroadcastCardSchema, PastBroadcastCardSchema]),
  ),
  counts: PublicEventListingCountsSchema,
  pagination: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  /**
   * Present exactly on a horizon read (D2): the applied window, echoed so the
   * client never re-derives it; the next bound «Показать ещё» writes into the
   * URL — `nextTo` on «Будущие», `nextFrom` (an older `from`) on
   * «Прошедшие», each `null` when nothing lies beyond; `remaining`, the
   * matching events beyond the extent; and `nextBatch`, the ones the next step
   * adds; and `today`, the api's day the window resolved against (D10). Same
   * names and semantics as the doctor feed's `today` / `from` / `to` /
   * `nextTo` / `nextFrom` / `remaining` / `nextBatch`.
   */
  horizon: z
    .object({
      /** Wave-2 gate §4.3 D10 — the api's «сегодня» (МСК), the doctor feed's `today`. */
      today: DoctorEventsFeedDaySchema,
      from: DoctorEventsFeedDaySchema,
      to: DoctorEventsFeedDaySchema,
      nextTo: DoctorEventsFeedDaySchema.nullable(),
      nextFrom: DoctorEventsFeedDaySchema.nullable(),
      remaining: z.number().int().nonnegative(),
      nextBatch: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * 014 EARS-12 — the facet options the panel lists, present exactly on a
   * horizon read (the page the panel sits on). Additive.
   */
  facets: PublicEventFacetOptionsSchema.optional(),
});
export type PublicEventListingPage = z.infer<
  typeof PublicEventListingPageSchema
>;
