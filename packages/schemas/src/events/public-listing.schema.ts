import { z } from "zod";
import { RecordingProjectionSchema } from "../recordings/recordings.schema.js";
import { UpcomingBroadcastCardSchema } from "./events.schema.js";

/** 014 EARS-11 selector; the legacy no-query/upcoming array remains stable. */
export const EventListingTimeframeSchema = z.enum(["upcoming", "past"]);
export type EventListingTimeframe = z.infer<typeof EventListingTimeframeSchema>;

export const PublicEventListingQuerySchema = z.object({
  timeframe: EventListingTimeframeSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
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
});
export type PublicEventListingPage = z.infer<
  typeof PublicEventListingPageSchema
>;
