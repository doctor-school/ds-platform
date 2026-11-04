import NextLink from "next/link";
import { headers } from "next/headers";
import { Link } from "@ds/design-system/link";
import { forwardedSessionFrom, specialtyEventsHref } from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import { eventNounOf } from "../copy/listing-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  type BlockRead,
  type EventsFeedCard,
  plainEmptyFeedState,
} from "../model/feed";
import { fetchSpecialtyFeedEvents, readRequestFrom } from "../server";
import { BlockError } from "./block-error";
import { BlockRetry } from "./block-retry";
import type { EventsBlockRetryAction } from "./events-block-retry";
import { readMyEvents } from "./feed-sections";
import { FeedList } from "./feed-list";

const COPY = FEED_COPY.specialtyEvents;

/**
 * 018 EARS-4 (#1499) — the nearest-events block of the specialty feed
 * (`design-source/doctor-feed.dc.html`, «d-feed · события»): the kicker, the
 * «Ближайшие события» heading, «Все события по специальности →» into 019's
 * events feed scoped to the specialty, and the nearest events as the events
 * page's own card list.
 *
 * It builds no events feed of its own: the items are 019's card payload from
 * `GET /v1/storefront/feed/{specialty}/events` (the api's 019 targeted read),
 * mapped by the ONE doctor card adapter and rendered by the feed's
 * `FeedList` — the same `EventList` card unit, the same sign-up counter rule
 * (no line at all for `signUpCount: null`), the same offline format marker and
 * the same НМО chip as the events page. The viewer's registered marks come
 * from the same «Мои события» read the events page uses.
 *
 * Its states are the events feed block's own (#3616 — a «nearest N» states
 * nothing of its own): the feed's error copy and empty state, and a failed
 * read's «Повторить» re-runs this block's read alone through the host's
 * block-retry action. Only the heading row is the specialty feed's.
 */
export async function SpecialtyEventsBlock({
  config,
  specialtyCode,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  specialtyCode: string;
  retry: EventsBlockRetryAction;
}) {
  const requestHeaders = await headers();
  const [read, mine] = await Promise.all([
    fetchSpecialtyFeedEvents(specialtyCode, readRequestFrom(requestHeaders)),
    readMyEvents(
      config.contentSet.myEventsPath,
      forwardedSessionFrom(requestHeaders),
    ),
  ]);
  const registeredSlugs =
    mine.ok && mine.value ? mine.value.map((event) => event.slug) : [];
  const allEventsHref = read.ok
    ? read.value.allEventsHref
    : specialtyEventsHref(specialtyCode);

  return (
    <section
      aria-labelledby="specialty-feed-events-heading"
      className="mt-12 px-4 layout:mt-20 layout:px-12"
      data-feed-kind="events"
      data-testid="specialty-feed-events"
    >
      <div className="mx-auto w-full max-w-content">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 layout:mb-8">
          <div>
            <p className="mb-2.5 text-xs font-extrabold uppercase tracking-widest text-primary-action">
              {COPY.kicker}
            </p>
            <h2
              id="specialty-feed-events-heading"
              className="text-2xl font-extrabold leading-none tracking-tight text-foreground layout:text-4xl"
            >
              {COPY.heading}
            </h2>
          </div>
          <Link asChild variant="inline" weight="strong" size="sm">
            <NextLink
              data-testid="specialty-feed-all-events"
              href={allEventsHref}
            >
              {COPY.allEvents}
            </NextLink>
          </Link>
        </div>
        <SpecialtyEventsList
          config={config}
          specialtyCode={specialtyCode}
          read={read}
          registeredSlugs={registeredSlugs}
          retry={retry}
        />
      </div>
    </section>
  );
}

/**
 * The block's body from its read — what its «Повторить» re-renders, so a
 * retry re-runs this read alone and every other block stays as it is.
 */
export function SpecialtyEventsList({
  config,
  specialtyCode,
  read,
  registeredSlugs,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  specialtyCode: string;
  read: BlockRead<{ cards: EventsFeedCard[]; allEventsHref: string }>;
  registeredSlugs: readonly string[];
  retry: EventsBlockRetryAction;
}) {
  if (!read.ok) {
    return (
      <BlockRetry
        retry={retry.bind(null, {
          block: "specialty-events",
          specialty: specialtyCode,
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
  return (
    <FeedList
      cards={read.value.cards}
      tense="upcoming"
      registeredSlugs={registeredSlugs}
      routes={config.routes}
      remaining={0}
      showMore={null}
      empty={plainEmptyFeedState(eventNounOf(config.copy), FEED_COPY)}
    />
  );
}
