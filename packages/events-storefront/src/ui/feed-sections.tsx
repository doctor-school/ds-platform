import { Skeleton } from "@ds/design-system/skeleton";
import {
  type MyEventItem,
  type RawQueryRecord,
  rawQueryScalar,
} from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import { eventNounOf } from "../copy/listing-copy";
import { type PluralNoun, formatEventCount } from "../model/event-count";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  type BlockRead,
  type EmptyFeedState,
  type EventsFeedPage,
  type FeedFacetOptions,
  emptyFeedState,
  feedReadsEmpty,
  plainEmptyFeedState,
  showMoreLabel,
} from "../model/feed";
import type { SpecialtyChoice } from "../model/facets";
import { feedTenseOf, showMoreHref } from "../model/feed-url";
import {
  type ForwardedSession,
  type ReadRequest,
  fetchEventsFeed,
  fetchEventsLive,
  fetchMyEvents,
} from "../server";
import { BlockError } from "./block-error";
import { BlockRetry } from "./block-retry";
import type { EventsBlockRetryAction } from "./events-block-retry";
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
 * The specialty book, read on demand: only an empty state that names a picked
 * specialty reads it, so a block's retry re-reads it only then.
 */
export type SpecialtyBook = () => Promise<readonly SpecialtyChoice[]>;

/**
 * The empty state of either view (019 EARS-9, #2786): each applied condition in
 * the canvas order is counted by a feed read of the same tense without it —
 * one read at a time, stopping at the first that finds events; a failed read
 * counts nothing for its condition. A picked specialty is named from the
 * specialty book. Made only for an empty reading.
 */
export async function readEmptyFeedState(
  config: EventsStorefrontHostConfig,
  query: RawQueryRecord,
  titles: FeedFacetOptions,
  specialties: SpecialtyBook,
  request: ReadRequest,
): Promise<EmptyFeedState> {
  const book = await specialties();
  return emptyFeedState(query, {
    listing: config.routes.listing,
    noun: eventNounOf(config.copy),
    copy: FEED_COPY,
    filterSet: config.filterSet,
    titles,
    specialtyName: (code) => book.find((choice) => choice.code === code)?.name,
    matching: async (without) => {
      const read = await fetchEventsFeed(config, without, request);
      return read.ok ? read.value.matching : null;
    },
  });
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
  retry,
}: {
  config: EventsStorefrontHostConfig;
  mine: Promise<BlockRead<readonly MyEventItem[] | null>>;
  retry: EventsBlockRetryAction;
}) {
  return MyEventsBlock({ config, read: await mine, retry });
}

/**
 * «Мои события» from its read — the block its «Повторить» re-renders (019
 * EARS-9, #2832): a failure retries the viewer's registrations read alone.
 */
export function MyEventsBlock({
  config,
  read,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  read: BlockRead<readonly MyEventItem[] | null>;
  retry: EventsBlockRetryAction;
}) {
  if (!read.ok) {
    return (
      <BlockRetry retry={retry.bind(null, { block: "my-events" })}>
        <BlockError
          title={FEED_COPY.my.errorTitle}
          description={FEED_COPY.my.errorBody}
          testId="events-my-events-error"
        />
      </BlockRetry>
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
  specialties,
  request,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  query: RawQueryRecord;
  feed: Promise<BlockRead<EventsFeedPage>>;
  mine: Promise<BlockRead<readonly MyEventItem[] | null>>;
  /** The specialty book — read only to name a picked specialty in the empty state. */
  specialties: Promise<readonly SpecialtyChoice[]>;
  request: ReadRequest;
  /** The host's block retry: the failed feed's «Повторить» re-runs the feed read alone. */
  retry: EventsBlockRetryAction;
}) {
  const [read, registered] = await Promise.all([feed, mine]);
  return FeedBlock({
    config,
    query,
    read,
    registeredSlugs:
      registered.ok && registered.value
        ? registered.value.map((event) => event.slug)
        : [],
    specialties: () => specialties,
    request,
    retry,
  });
}

/**
 * The day feed from its read — the block its «Повторить» re-renders (019
 * EARS-9, #2832). The viewer's registered marks arrive as data from the
 * page's «Мои события» read, so a retry re-runs the feed read alone.
 */
export async function FeedBlock({
  config,
  query,
  read,
  registeredSlugs,
  specialties,
  request,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  query: RawQueryRecord;
  read: BlockRead<EventsFeedPage>;
  registeredSlugs: readonly string[];
  specialties: SpecialtyBook;
  request: ReadRequest;
  retry: EventsBlockRetryAction;
}) {
  const tense = feedTenseOf(query);
  if (!read.ok) {
    return (
      <BlockRetry
        retry={retry.bind(null, {
          block: "feed",
          raw: query,
          registeredSlugs: [...registeredSlugs],
        })}
      >
        <BlockError
          title={FEED_COPY.feed.errorTitle}
          description={FEED_COPY.feed.errorBody}
          testId="events-feed-error"
        />
      </BlockRetry>
    );
  }
  const page = read.value;
  const more = showMoreHref(config.routes.listing, query, page.horizon);
  const empty = feedReadsEmpty(page)
    ? await readEmptyFeedState(
        config,
        query,
        page.facetOptions,
        specialties,
        request,
      )
    : plainEmptyFeedState(eventNounOf(config.copy), FEED_COPY);
  return (
    <>
      <DayAnchorScroll day={rawQueryScalar(query.day) ?? null} />
      <FeedList
        cards={page.cards}
        tense={tense}
        registeredSlugs={registeredSlugs}
        routes={config.routes}
        remaining={page.remaining}
        showMore={
          more === null
            ? null
            : {
                href: more,
                label: showMoreLabel(page.nextBatch, page.remaining, FEED_COPY),
              }
        }
        empty={empty}
      />
    </>
  );
}
