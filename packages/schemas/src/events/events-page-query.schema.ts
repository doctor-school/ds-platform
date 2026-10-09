import { z } from "zod";

import { SlugSchema } from "../taxonomy/taxonomy.schema.js";
import {
  DOCTOR_EVENTS_FEED_QUERY_FIELDS,
  DoctorEventsFeedQuerySchema,
} from "./doctor-events-feed.schema.js";
import { createEventListingQueryCodec } from "./event-listing-query.schema.js";
import { MONTH_PARAM, MonthBroadcastListSchema } from "./events.schema.js";

/**
 * The events PAGE's URL — ONE codec for both storefronts and both views of the
 * shared page (019 LD-1; wave-2 entry gate rows 17, 51; §4.3 D1): the view
 * (`view=month`; absent = the feed), the displayed month, the tense, the
 * horizon and every facet of either host's set (the doctor feed fields plus
 * the Academy `project`, `expert`, `topic` of 014 EARS-12). The page writes
 * every href through it; each host's READ is then handed only its own keys.
 * A malformed `view` / `month` reads as absent rather than voiding the URL.
 */
export const EventsPageQuerySchema = DoctorEventsFeedQuerySchema.extend({
  view: z.enum(["month"]).optional().catch(undefined),
  month: z.string().regex(MONTH_PARAM).optional().catch(undefined),
  project: z.array(SlugSchema).default([]),
  expert: z.array(SlugSchema).default([]),
  topic: z.array(SlugSchema).default([]),
});
export type EventsPageQuery = z.infer<typeof EventsPageQuerySchema>;

export const EVENTS_PAGE_QUERY_CODEC = createEventListingQueryCodec({
  schema: EventsPageQuerySchema,
  fields: [
    { key: "view", kind: "scalar" },
    { key: "month", kind: "scalar" },
    ...DOCTOR_EVENTS_FEED_QUERY_FIELDS,
    { key: "project", kind: "list" },
    { key: "expert", kind: "list" },
    { key: "topic", kind: "list" },
  ],
});

/**
 * A month read's entries as the shared page reads them (row 14): the Academy
 * month read answers the entry list, the doctor month read its month grid,
 * which carries the same `MonthBroadcastEntry` list as `entries` — one
 * envelope check, no host callback (gate §4.5).
 */
export const EventsMonthEntriesReadSchema = z.union([
  MonthBroadcastListSchema,
  z
    .object({ entries: MonthBroadcastListSchema })
    .transform((grid) => grid.entries),
]);
