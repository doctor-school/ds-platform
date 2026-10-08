"use client";

import Link from "next/link";
import { Button } from "@ds/design-system/button";
import { EmptyState, EventList } from "@ds/design-system/blocks";

import { FEED_COPY } from "../copy/feed-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  type EmptyFeedState,
  type EventsFeedCard,
  type FeedTense,
  buildFeedItems,
} from "../model/feed";
import { useViewerZone } from "./use-viewer-zone";

/**
 * The day feed (019 EARS-3; gate rows 30–40): the read's cards in the
 * design-system `EventList`, grouped by the day of the shown time («Будущие») or
 * by month newest first («Прошедшие»), with the one forward «Показать ещё» link
 * that widens the horizon in the URL (019 LD-2, D2). Times re-format to the
 * viewer zone after hydration (004 «Amendment — 2026-10-02»).
 */
export function FeedList({
  cards,
  tense,
  registeredSlugs,
  routes,
  showMore,
  empty,
}: {
  cards: readonly EventsFeedCard[];
  tense: FeedTense;
  registeredSlugs: readonly string[];
  routes: Pick<EventsStorefrontHostConfig["routes"], "eventPage">;
  showMore: { href: string; label: string } | null;
  empty: EmptyFeedState;
}) {
  const viewerZone = useViewerZone();

  if (cards.length === 0) {
    return (
      <section
        className="border-2 border-dashed border-border"
        data-feed-block="feed"
        data-testid="events-feed-empty"
      >
        <EmptyState
          variant="no-records"
          title={empty.title}
          {...(empty.description ? { description: empty.description } : {})}
          {...(empty.action
            ? {
                action: (
                  <Button asChild variant="outline">
                    <Link href={empty.action.href}>{empty.action.label}</Link>
                  </Button>
                ),
              }
            : {})}
        />
      </section>
    );
  }

  const items = buildFeedItems(cards, {
    tense,
    viewerZone,
    registeredSlugs: new Set(registeredSlugs),
    routes,
    copy: FEED_COPY,
  });
  return (
    <section data-feed-block="feed" data-testid="events-feed">
      <EventList
        items={items}
        selectedTab={tense}
        tenseControl="none"
        paginationMode="none"
        labels={{
          emptyTitle: empty.title,
          pagination: FEED_COPY.feed.pagination,
        }}
        footer={
          showMore === null ? null : (
            <Button
              asChild
              className="mt-8"
              size="lg"
              variant="outline"
            >
              <Link data-testid="events-feed-show-more" href={showMore.href}>
                {showMore.label}
              </Link>
            </Button>
          )
        }
      />
    </section>
  );
}
