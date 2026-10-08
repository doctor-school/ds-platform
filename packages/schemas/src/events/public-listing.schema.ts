import { z } from "zod";
import { RecordingProjectionSchema } from "../recordings/recordings.schema.js";
import { DoctorEventsFeedDaySchema } from "./doctor-events-feed.schema.js";
import { UpcomingBroadcastCardSchema } from "./events.schema.js";

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
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).optional(),
    from: DoctorEventsFeedDaySchema.optional(),
    to: DoctorEventsFeedDaySchema.optional(),
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
   * «Прошедшие», each `null` when nothing lies beyond; and `remaining`, the
   * matching events beyond the extent. Same names and semantics as the doctor
   * feed's `from` / `to` / `nextTo` / `nextFrom` / `remaining`.
   */
  horizon: z
    .object({
      from: DoctorEventsFeedDaySchema,
      to: DoctorEventsFeedDaySchema,
      nextTo: DoctorEventsFeedDaySchema.nullable(),
      nextFrom: DoctorEventsFeedDaySchema.nullable(),
      remaining: z.number().int().nonnegative(),
    })
    .optional(),
});
export type PublicEventListingPage = z.infer<
  typeof PublicEventListingPageSchema
>;
