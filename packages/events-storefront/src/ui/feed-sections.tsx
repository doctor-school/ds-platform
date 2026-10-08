import { Skeleton } from "@ds/design-system/skeleton";
import { type MyEventItem, type RawQueryRecord, rawQueryScalar } from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import { eventNounOf } from "../copy/listing-copy";
import { type PluralNoun, formatEventCount } from "../model/event-count";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  type BlockRead,
  type EventsFeedPage,
  emptyFeedState,
  showMoreLabel,
} from "../model/feed";
import { feedTenseOf, showMoreHref } from "../model/feed-url";
import { type ForwardedSession, fetchEventsLive, fetchMyEvents } from "../server";
import { BlockError } from "./block-error";
import { DayAnchorScroll } from "./day-anchor-scroll";
import { FeedList } from "./feed-list";
import { LiveBlock } from "./live-block";
import { MyEventsCut } from "./my-events-cut";

/** The viewer's upcoming registrations; `null` for a guest. */
export async function readMyEvents(
  path: string,
  session: ForwardedSession,
): Promise<BlockRead<readonly MyEventItem[] | null>> {
  try {
    const result = await fetchMyEvents(path, session);
    return {
      ok: true,
      value: result.authenticated ? result.events.data : null,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * A skeleton in a sized slot: the slot is layout (where the placeholder sits
 * and how much room it reserves, the canvas `sk(height, width)` boxes); the
 * primitive keeps its own fill and pulse.
 */
export function SkeletonSlot({ className }: { className: string }) {
  return (
    <div className={className}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

export function LiveSkeleton() {
  return (
    <div data-testid="events-live-skeleton">
      <SkeletonSlot className="h-24 w-full" />
    </div>
  );
}

export function MyEventsSkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      data-testid="events-my-events-skeleton"
    >
      <SkeletonSlot className="h-3.5 w-40" />
      <SkeletonSlot className="h-18 w-full" />
      <SkeletonSlot className="h-18 w-full" />
    </div>
  );
}

function FeedSkeletonCard() {
  return (
    <div className="flex flex-col border-2 border-hairline bg-card layout:flex-row">
      <div className="flex shrink-0 flex-col gap-3 bg-section px-6 py-7 layout:w-52">
        <SkeletonSlot className="h-9 w-26" />
        <SkeletonSlot className="h-3 w-22" />
      </div>
      <div className="flex flex-1 flex-col gap-3.5 p-7">
        <SkeletonSlot className="h-3 w-2/5" />
        <SkeletonSlot className="h-5.5 w-5/6" />
        <SkeletonSlot className="h-5.5 w-7/12" />
        <SkeletonSlot className="h-3 w-2/5" />
      </div>
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-10" data-testid="events-feed-skeleton">
      {[2, 1].map((cards, day) => (
        <div className="flex flex-col gap-6" key={day}>
          <SkeletonSlot className="h-4 w-60" />
          {Array.from({ length: cards }, (_, i) => (
            <FeedSkeletonCard key={i} />
          ))}
        </div>
      ))}
    </div>
  );
}

export async function LiveSection({
  config,
  session,
}: {
  config: EventsStorefrontHostConfig;
  session: ForwardedSession;
}) {
  const initial = await fetchEventsLive(config.contentSet.livePath, session);
  return (
    <LiveBlock
      initial={initial}
      livePath={config.contentSet.livePath}
      routes={config.routes}
    />
  );
}

export async function MyEventsSection({
  config,
  mine,
}: {
  config: EventsStorefrontHostConfig;
  mine: Promise<BlockRead<readonly MyEventItem[] | null>>;
}) {
  const read = await mine;
  if (!read.ok) {
    return (
      <BlockError
        title={FEED_COPY.my.errorTitle}
        description={FEED_COPY.my.errorBody}
        testId="events-my-events-error"
      />
    );
  }
  if (read.value === null) return null;
  return <MyEventsCut events={read.value} routes={config.routes} />;
}

/**
 * The counted head subline «N эфиров · M школ» (gate row 19, the canvas
 * `headCount`), off the same feed read the day feed renders. A failed read
 * states nothing here — the feed block below carries the cause.
 */
export async function CountedSubline({
  feed,
  eventNoun,
  schoolNoun,
}: {
  feed: Promise<BlockRead<EventsFeedPage>>;
  eventNoun: PluralNoun;
  schoolNoun: PluralNoun;
}) {
  const read = await feed;
  if (!read.ok || read.value.summary === undefined) return null;
  const { events, schools } = read.value.summary;
  return (
    <span data-testid="events-feed-subline-counts">
      {formatEventCount(events, eventNoun)} ·{" "}
      {formatEventCount(schools, schoolNoun)}
    </span>
  );
}

export async function FeedSection({
  config,
  query,
  feed,
  mine,
}: {
  config: EventsStorefrontHostConfig;
  query: RawQueryRecord;
  feed: Promise<BlockRead<EventsFeedPage>>;
  mine: Promise<BlockRead<readonly MyEventItem[] | null>>;
}) {
  const tense = feedTenseOf(query);
  const [read, registered] = await Promise.all([feed, mine]);
  if (!read.ok) {
    return (
      <BlockError
        title={FEED_COPY.feed.errorTitle}
        description={FEED_COPY.feed.errorBody}
        testId="events-feed-error"
      />
    );
  }
  const page = read.value;
  const more = showMoreHref(config.routes.listing, query, page.horizon);
  return (
    <>
      <DayAnchorScroll day={rawQueryScalar(query.day) ?? null} />
      <FeedList
        cards={page.cards}
        tense={tense}
        registeredSlugs={
          registered.ok && registered.value
            ? registered.value.map((event) => event.slug)
            : []
        }
        routes={config.routes}
        remaining={page.remaining}
        showMore={
          more === null
            ? null
            : { href: more, label: showMoreLabel(page.nextBatch, page.remaining, FEED_COPY) }
        }
        empty={emptyFeedState(query, {
          listing: config.routes.listing,
          noun: eventNounOf(config.copy),
          copy: FEED_COPY,
          titles: page.facetOptions,
        })}
      />
    </>
  );
}
