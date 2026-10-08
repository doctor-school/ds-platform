import { type ReactNode, Suspense } from "react";
import { headers } from "next/headers";
import { Skeleton } from "@ds/design-system/skeleton";
import type { MyEventItem, RawQueryRecord } from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import { eventNounOf } from "../copy/listing-copy";
import { type PluralNoun, formatEventCount } from "../model/event-count";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  type BlockRead,
  type EventsFeedHorizon,
  type EventsFeedPage,
  emptyFeedState,
  showMoreLabel,
} from "../model/feed";
import { feedTenseOf, showMoreHref, tenseHref } from "../model/feed-url";
import {
  type ForwardedSession,
  fetchEventsFeed,
  fetchEventsLive,
  fetchMyEvents,
  forwardedSessionFrom,
} from "../server";
import { BlockError } from "./block-error";
import { FeedFrame } from "./feed-frame";
import { FeedList } from "./feed-list";
import { LiveBlock } from "./live-block";
import { MyEventsCut } from "./my-events-cut";

/** The viewer's upcoming registrations; `null` for a guest. */
async function readMyEvents(
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
function SkeletonSlot({ className }: { className: string }) {
  return (
    <div className={className}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

function LiveSkeleton() {
  return (
    <div data-testid="events-live-skeleton">
      <SkeletonSlot className="h-24 w-full" />
    </div>
  );
}

function MyEventsSkeleton() {
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

function FeedSkeleton() {
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
  monthNav,
}: {
  config: EventsStorefrontHostConfig;
  query: RawQueryRecord;
  feed: Promise<BlockRead<EventsFeedPage>>;
  mine: Promise<BlockRead<readonly MyEventItem[] | null>>;
  monthNav?: ((horizon: EventsFeedHorizon) => ReactNode) | undefined;
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
      {monthNav?.(page.horizon)}
      <FeedList
        cards={page.cards}
        tense={tense}
        registeredSlugs={
          registered.ok && registered.value
            ? registered.value.map((event) => event.slug)
            : []
        }
        routes={config.routes}
        showMore={
          more === null
            ? null
            : { href: more, label: showMoreLabel(page.remaining, FEED_COPY) }
        }
        empty={emptyFeedState(query, {
          listing: config.routes.listing,
          noun: eventNounOf(config.copy),
          copy: FEED_COPY,
        })}
      />
    </>
  );
}

/**
 * The events feed view of both storefronts (wave-2 entry gate §2.4, the #2076
 * canvas): the head with the tense tabs, then «Идёт сейчас», «Мои события» and
 * the day feed (row 50). Each block reads on its own and streams behind its own
 * skeleton (019 EARS-9); a block whose read fails shows its cause and a retry
 * while the others stay usable (row 48). The live block and «Мои события» belong
 * to «Будущие»; «Мои события» is a signed-in reader's block only (019 EARS-11).
 *
 * `headAction` and `monthNav` carry the month navigation each host keeps until
 * the same-page month view replaces both in PR 2.5 (gate §4.1, «After 2.4»).
 */
export async function EventsFeedView({
  config,
  query,
  headAction,
  monthNav,
}: {
  config: EventsStorefrontHostConfig;
  query: RawQueryRecord;
  headAction?: ReactNode;
  monthNav?: (horizon: EventsFeedHorizon) => ReactNode;
}) {
  const tense = feedTenseOf(query);
  const requestHeaders = await headers();
  const session = forwardedSessionFrom(requestHeaders);
  const mine = readMyEvents(config.contentSet.myEventsPath, session);
  // One feed read serves the day feed and the counted head subline.
  const feed = fetchEventsFeed(config.contentSet, query, {
    cookie: requestHeaders.get("cookie") ?? "",
    forwardedFor: requestHeaders.get("x-forwarded-for") ?? "",
  });
  const listing = config.routes.listing;
  const { subline } = config.headerCopy;

  return (
    <FeedFrame
      title={config.headerCopy.title}
      subline={
        typeof subline === "string" ? (
          subline
        ) : (
          <Suspense fallback={<SkeletonSlot className="inline-block h-4 w-48" />}>
            <CountedSubline
              feed={feed}
              eventNoun={eventNounOf(config.copy)}
              schoolNoun={subline.schoolNoun}
            />
          </Suspense>
        )
      }
      tense={tense}
      hrefs={{
        upcoming: tenseHref(listing, query, "upcoming"),
        past: tenseHref(listing, query, "past"),
      }}
      headAction={headAction}
    >
      {tense === "upcoming" ? (
        <Suspense fallback={<LiveSkeleton />}>
          <LiveSection config={config} session={session} />
        </Suspense>
      ) : null}
      {tense === "upcoming" && session.cookie !== "" ? (
        <Suspense fallback={<MyEventsSkeleton />}>
          <MyEventsSection config={config} mine={mine} />
        </Suspense>
      ) : null}
      <Suspense fallback={<FeedSkeleton />}>
        <FeedSection
          config={config}
          query={query}
          feed={feed}
          mine={mine}
          monthNav={monthNav}
        />
      </Suspense>
    </FeedFrame>
  );
}
