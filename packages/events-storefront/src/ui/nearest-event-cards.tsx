"use client";

import { WebinarCard } from "@ds/design-system/webinar-card";

import { FEED_COPY } from "../copy/feed-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import { type EventsFeedCard, buildFeedItems } from "../model/feed";
import { useViewerZone } from "./use-viewer-zone";

/**
 * The home block's nearest events (017 EARS-9): the feed's card unit — the
 * same `buildFeedItems` mapping onto the design-system `WebinarCard` the day
 * feed renders — as a flat list without day groups, the canvas
 * `unit-event-card` stack of `design-source/doctor-home.dc.html`, the
 * viewer's registered events in the unit's «Вы записаны» state. Times
 * re-format to the viewer zone after hydration, as on the feed.
 */
export function NearestEventCards({
  cards,
  registeredSlugs,
  routes,
}: {
  cards: readonly EventsFeedCard[];
  registeredSlugs: readonly string[];
  routes: Pick<EventsStorefrontHostConfig["routes"], "eventPage">;
}) {
  const viewerZone = useViewerZone();
  const items = buildFeedItems(cards, {
    tense: "upcoming",
    viewerZone,
    registeredSlugs: new Set(registeredSlugs),
    routes,
    copy: FEED_COPY,
  });
  return (
    <ul className="isolate flex flex-col gap-4.5 layout:gap-7" role="list">
      {items.map(({ id, groupKey: _groupKey, groupLabel: _groupLabel, ...card }) => (
        <li key={id}>
          <WebinarCard {...card} />
        </li>
      ))}
    </ul>
  );
}
