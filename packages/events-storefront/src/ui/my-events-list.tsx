"use client";

import type { MyEventItem, MyEventsCounts, MyEventsTab } from "@ds/schemas";

import { MY_EVENTS_COPY as COPY } from "../copy/my-events-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import { buildMyEventListItems } from "../model/my-events-items";
import { EventListRouter } from "./event-list-router";
import { useViewerZone } from "./use-viewer-zone";

/**
 * The «Мои события» tabs and rows (014 EARS-9, gate rows 25–26). A client
 * component because the times follow the viewer zone (004 EARS-12 as amended
 * 2026-10-02): the server and the first client render read МСК, so hydration
 * matches and nothing shifts; after mount an online or hybrid row re-formats to
 * the viewer's zone, an offline row stays МСК.
 *
 * `MyEvents` returns a whole tab at once — no paging; `pageCount = 1` makes the
 * shared `Pagination` block render nothing at all.
 */
export function MyEventsList({
  events,
  tab,
  counts,
  routes,
}: {
  events: readonly MyEventItem[];
  tab: MyEventsTab;
  counts: MyEventsCounts;
  routes: Pick<
    EventsStorefrontHostConfig["routes"],
    "eventPage" | "accountEvents"
  >;
}) {
  const viewerZone = useViewerZone();
  const recordings = tab === "recordings";
  const items = buildMyEventListItems(events, tab, {
    copy: {
      dateLabel: ({ date, weekday }) => COPY.cardDate(date, weekday),
      live: COPY.live,
      recordingLabel: (state) => COPY.recording[state],
      recordingCta: COPY.recordingCta,
      roomCta: COPY.roomCta,
    },
    routes,
    viewerZone,
  });
  const empty = recordings ? COPY.recordingsEmpty : COPY.empty;

  return (
    <EventListRouter
      basePath={routes.accountEvents}
      pastTabParam="recordings"
      items={items}
      selectedTab={recordings ? "past" : "upcoming"}
      counts={{ upcoming: counts.upcoming, past: counts.recordings }}
      labels={{
        upcoming: COPY.tabs.upcoming,
        past: COPY.tabs.recordings,
        emptyTitle: empty.title,
        emptyDescription: empty.body,
        pagination: COPY.pagination.label,
        previous: COPY.pagination.previous,
        next: COPY.pagination.next,
        pagePrefix: COPY.pagination.page,
      }}
      paginationMode="pages"
      pageCount={1}
      page={1}
      nextCursor={null}
      hasMore={false}
    />
  );
}
