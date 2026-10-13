import type { ReactNode } from "react";
import { headers } from "next/headers";
import { z } from "zod";
import { MONTH_PARAM } from "@ds/schemas";

import type { EventsStorefrontHostConfig } from "../host-config";
import type { EventsFeedHorizon, FeedFacetOptions } from "../model/feed";
import {
  fetchEventsFeed,
  fetchMonthEntries,
  fetchSpecialtyChoices,
  forwardedSessionFrom,
  readRequestFrom,
} from "../server";
import { FeedBlock, MyEventsBlock, readMyEvents } from "./feed-sections";
import { RecoveredFeedRead } from "./feed-read-scope";
import { MonthGridBlock } from "./month-view";

const RawQuerySchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]).optional(),
);
const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FacetOptionsSchema = z.record(
  z.string(),
  z.array(z.object({ slug: z.string(), title: z.string(), count: z.number() })),
);

/**
 * Which failed block a «Повторить» re-renders, with what the block takes from
 * the page beside its own read (019 EARS-9, #2832). It crosses the wire from
 * the browser, so the action parses it before any read; nothing in it widens
 * what the caller may read — every read forwards the caller's own request.
 */
const EventsBlockRetryInputSchema = z.discriminatedUnion("block", [
  z.object({
    block: z.literal("month"),
    raw: RawQuerySchema,
    month: z.string().regex(MONTH_PARAM),
    today: DaySchema,
    horizon: z
      .object({
        from: z.string(),
        to: z.string(),
        nextTo: z.string().nullable(),
        nextFrom: z.string().nullable(),
      })
      .optional(),
    facetOptions: FacetOptionsSchema,
  }),
  z.object({
    block: z.literal("feed"),
    raw: RawQuerySchema,
    registeredSlugs: z.array(z.string()),
  }),
  z.object({ block: z.literal("my-events") }),
]);

export type EventsBlockRetryInput =
  | {
      readonly block: "month";
      readonly raw: Record<string, string | string[] | undefined>;
      readonly month: string;
      readonly today: string;
      readonly horizon?: EventsFeedHorizon;
      readonly facetOptions: FeedFacetOptions;
    }
  | {
      readonly block: "feed";
      readonly raw: Record<string, string | string[] | undefined>;
      readonly registeredSlugs: string[];
    }
  | { readonly block: "my-events" };

/**
 * The host's block-retry server action: a host's `"use server"` module exports
 * it as `renderEventsBlock(<host config>, <the action itself>, input)` and
 * mounts the page with it (gate §5 — the host wires, the package decides).
 */
export type EventsBlockRetryAction = (
  input: EventsBlockRetryInput,
) => Promise<ReactNode>;

/**
 * One failed block of the events page, read and rendered again (019 EARS-9,
 * #2832): the month grid re-runs the month read, the day feed the feed read,
 * «Мои события» the viewer's registrations read — and nothing else. The
 * answer is that block alone (a recovered feed also hands its read to the
 * page's `FeedReadScope`, which fills the facets and the subline the
 * failed read left out); the browser puts it in place of the failed one,
 * so no other block re-reads. «Идёт сейчас» needs none: its block re-reads its
 * own same-origin path (row 43, D5).
 */
export async function renderEventsBlock(
  config: EventsStorefrontHostConfig,
  retry: EventsBlockRetryAction,
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  const parsed = EventsBlockRetryInputSchema.parse(input);
  const requestHeaders = await headers();
  const request = readRequestFrom(requestHeaders);
  const specialties = () =>
    config.filterSet === "doctor"
      ? fetchSpecialtyChoices()
      : Promise.resolve([]);

  switch (parsed.block) {
    case "month":
      return MonthGridBlock({
        config,
        raw: parsed.raw,
        month: parsed.month,
        today: parsed.today,
        horizon: parsed.horizon,
        facetOptions: parsed.facetOptions,
        entries: await fetchMonthEntries(config, parsed.raw, parsed.month, request),
        specialties,
        request,
        retry,
      });
    case "feed": {
      // The page's one feed read, re-run: the day feed renders from it, and
      // what the page derives from it (facets, «Показать N», the subline)
      // takes the same answer — no other read.
      const read = await fetchEventsFeed(config, parsed.raw, request);
      const block = await FeedBlock({
        config,
        query: parsed.raw,
        read,
        registeredSlugs: parsed.registeredSlugs,
        specialties,
        request,
        retry,
      });
      if (!read.ok) return block;
      return (
        <>
          <RecoveredFeedRead
            facetOptions={read.value.facetOptions}
            matching={read.value.matching}
            summary={read.value.summary}
          />
          {block}
        </>
      );
    }
    case "my-events":
      return MyEventsBlock({
        config,
        read: await readMyEvents(
          config.contentSet.myEventsPath,
          forwardedSessionFrom(requestHeaders),
        ),
        retry,
      });
  }
}
