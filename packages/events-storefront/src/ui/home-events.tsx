import { type ReactNode, Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@ds/design-system/blocks";
import { Link as DsLink } from "@ds/design-system/link";
import { forwardedSessionFrom } from "@ds/schemas";

import { HOME_EVENTS_COPY } from "../copy/home-copy";
import type {
  EventsStorefrontHostConfig,
  HomeEventsHostConfig,
} from "../host-config";
import type { BlockRead, EventsFeedPage } from "../model/feed";
import { type ReadRequest, fetchEventsFeed, readRequestFrom } from "../server";
import { BlockError } from "./block-error";
import { BlockRetry } from "./block-retry";
import { FeedSkeletonCard, readMyEvents } from "./feed-sections";
import { HomeEventCards } from "./home-event-cards";

/**
 * The host's home-block retry server action: a host's `"use server"` module
 * exports it as `renderHomeEventsBlock(<events config>, <home config>, <the
 * action itself>)` (the host wires, the package decides — gate §5).
 */
export type HomeEventsRetryAction = () => Promise<ReactNode>;

/**
 * The home block's ONE read — the events page's upcoming feed read with no
 * query (019 EARS-3): the same endpoint, the same relayed specialty cookie, so
 * the preview is general before a choice and targeted after it (017 EARS-9).
 */
function readHomeFeed(
  config: EventsStorefrontHostConfig,
  request: ReadRequest,
): Promise<BlockRead<EventsFeedPage>> {
  return fetchEventsFeed(config, {}, request);
}

function AllLink({
  config,
  home,
  className,
}: {
  config: EventsStorefrontHostConfig;
  home: HomeEventsHostConfig;
  className?: string;
}) {
  return (
    <DsLink asChild variant="inline">
      <Link
        className={className}
        data-testid="home-events-all"
        href={config.routes.listing}
      >
        {home.allLink.label}
      </Link>
    </DsLink>
  );
}

/** The block head: eyebrow, heading and — on a `head` host — the link. */
export function HomeEventsHead({
  config,
  home,
}: {
  config: EventsStorefrontHostConfig;
  home: HomeEventsHostConfig;
}) {
  return (
    <div className="mb-4.5 flex flex-wrap items-end justify-between gap-4.5 layout:mb-7.5">
      <div>
        <p
          className="mb-2.5 text-xs font-extrabold uppercase tracking-micro text-primary-action"
          data-testid="home-events-eyebrow"
        >
          {home.eyebrow}
        </p>
        <h2
          className="text-2xl font-extrabold leading-none tracking-tight text-foreground layout:text-4xl"
          id="home-events-title"
        >
          {home.title}
        </h2>
      </div>
      {home.allLink.placement === "head" ? (
        <AllLink className="whitespace-nowrap" config={config} home={home} />
      ) : null}
    </div>
  );
}

/** `cardCap` card skeletons while the read is in flight (017 design §6 `загрузка`). */
export function HomeEventsSkeleton({ home }: { home: HomeEventsHostConfig }) {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-4.5 layout:gap-7"
      data-testid="home-events-skeleton"
    >
      {Array.from({ length: home.cardCap }, (_, i) => (
        <FeedSkeletonCard key={i} />
      ))}
    </div>
  );
}

/**
 * The block's one render per read: the first `cardCap` cards of the feed, the
 * host's honest empty with its pointer into the feed, or the cause with
 * «Обновить» — whose retry re-runs this one read and replaces this block
 * alone (the {@link BlockRetry} contract of the events page, 019 EARS-9).
 */
export async function HomeEventsBody({
  config,
  home,
  read,
  registeredSlugs,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  home: HomeEventsHostConfig;
  read: BlockRead<EventsFeedPage>;
  registeredSlugs: readonly string[];
  retry: HomeEventsRetryAction;
}) {
  if (!read.ok) {
    return (
      <BlockRetry retry={retry}>
        <BlockError
          retryLabel={HOME_EVENTS_COPY.retry}
          testId="home-events-error"
          title={HOME_EVENTS_COPY.errorTitle}
        />
      </BlockRetry>
    );
  }
  const cards = read.value.cards.slice(0, home.cardCap);
  if (cards.length === 0) {
    const { pointer } = home.empty;
    return (
      <div
        className="border-2 border-dashed border-border"
        data-testid="home-events-empty"
      >
        <EmptyState
          variant="no-records"
          title={home.empty.title}
          {...(pointer
            ? {
                description: (
                  <>
                    {pointer.text}
                    {pointer.linkLabel ? (
                      <DsLink asChild variant="inline">
                        <Link href={config.routes.listing}>
                          {pointer.linkLabel}
                        </Link>
                      </DsLink>
                    ) : null}
                  </>
                ),
              }
            : {})}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4.5 layout:gap-7" data-testid="home-events-cards">
      <HomeEventCards
        cards={cards}
        registeredSlugs={registeredSlugs}
        routes={config.routes}
      />
      {home.allLink.placement === "foot" ? (
        <AllLink className="self-start" config={config} home={home} />
      ) : null}
    </div>
  );
}

async function readHomeBlock(
  config: EventsStorefrontHostConfig,
  requestHeaders: Headers,
) {
  const [read, mine] = await Promise.all([
    readHomeFeed(config, readRequestFrom(requestHeaders)),
    readMyEvents(
      config.contentSet.myEventsPath,
      forwardedSessionFrom(requestHeaders),
    ),
  ]);
  return {
    read,
    registeredSlugs:
      mine.ok && mine.value ? mine.value.map((event) => event.slug) : [],
  };
}

async function HomeEventsStream({
  config,
  home,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  home: HomeEventsHostConfig;
  retry: HomeEventsRetryAction;
}) {
  return renderHomeEventsBlock(config, home, retry);
}

/**
 * The failed home block, read and rendered again (017 EARS-9): the feed read
 * and the viewer's registrations — nothing else on the home page re-reads.
 */
export async function renderHomeEventsBlock(
  config: EventsStorefrontHostConfig,
  home: HomeEventsHostConfig,
  retry: HomeEventsRetryAction,
): Promise<ReactNode> {
  const { read, registeredSlugs } = await readHomeBlock(config, await headers());
  return HomeEventsBody({ config, home, read, registeredSlugs, retry });
}

/**
 * A storefront home's nearest-events block (017 EARS-9, #1485): a short
 * preview of the upcoming feed — the events page's feed read, its card unit,
 * the first `cardCap` cards — and a link into the full feed. No calendar,
 * filters, tabs, paging or day groups; those are the events page's.
 *
 * A host home route mounts it with its events config, its home values and its
 * retry action. The read streams behind its own Suspense boundary, so the rest
 * of the page renders and stays usable in every state: card skeletons while
 * the read is in flight, the honest empty, or the cause with a working retry.
 */
export function HomeEvents({
  config,
  home,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  home: HomeEventsHostConfig;
  retry: HomeEventsRetryAction;
}) {
  return (
    <section
      aria-labelledby="home-events-title"
      className="my-13 px-4 layout:my-23 layout:px-12"
      data-testid="home-events"
    >
      <div className="mx-auto w-full max-w-content">
        <HomeEventsHead config={config} home={home} />
        <Suspense fallback={<HomeEventsSkeleton home={home} />}>
          <HomeEventsStream config={config} home={home} retry={retry} />
        </Suspense>
      </div>
    </section>
  );
}
