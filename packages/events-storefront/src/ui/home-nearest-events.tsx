import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { EmptyState } from "@ds/design-system/blocks";
import { Link as DsLink } from "@ds/design-system/link";

import { HOME_EVENTS_COPY } from "../copy/home-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import type { BlockRead, EventsFeedPage } from "../model/feed";
import { nearestEventsState } from "../model/nearest-events";
import { type ReadRequest, fetchNearestEvents } from "../server";
import { BlockError } from "./block-error";
import { CompactMonthSection } from "./events-listing-page";
import { FeedSkeletonCard, SkeletonSlot } from "./feed-sections";
import { NearestEventCards } from "./nearest-event-cards";

type NearestRead = Promise<{
  readonly window: BlockRead<EventsFeedPage>;
  readonly nearest: BlockRead<EventsFeedPage>;
}>;

const T = HOME_EVENTS_COPY;

/** The card skeletons while the read is in flight (017 design §6 `загрузка`). */
export function NearestEventsSkeleton() {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-4.5 layout:gap-7"
      data-testid="home-events-skeleton"
    >
      {[0, 1, 2].map((i) => (
        <FeedSkeletonCard key={i} />
      ))}
    </div>
  );
}

/** The kicker above the title: «События», or the targeted line after a choice. */
async function NearestEventsKicker({ read }: { read: NearestRead }) {
  const state = nearestEventsState((await read).nearest);
  const targeted = state.kind !== "error" && state.targeted;
  return (
    <p
      className="mb-2.5 text-xs font-extrabold uppercase tracking-micro text-primary-action"
      data-testid="home-events-kicker"
    >
      {targeted ? T.kicker.targeted : T.kicker.general}
    </p>
  );
}

/**
 * The block's one render per read (017 design §6 «Nearest events»): cards +
 * the compact month, the honest `пусто`, or the cause with «Обновить» — whose
 * retry re-runs the server render and so re-issues the read.
 */
export async function NearestEventsBody({
  config,
  read,
  request,
}: {
  config: EventsStorefrontHostConfig;
  read: NearestRead;
  request: ReadRequest;
}) {
  const { window, nearest } = await read;
  const state = nearestEventsState(nearest);
  const statement = state.kind !== "error" && state.generalFallback ? (
    <p className="mb-5 text-sm text-muted-foreground" data-testid="home-events-general">
      {T.generalFallback}
    </p>
  ) : null;

  if (state.kind === "error") {
    return (
      <BlockError
        title={T.error.title}
        retryLabel={T.error.retry}
        testId="home-events-error"
      />
    );
  }
  if (state.kind === "empty") {
    return (
      <>
        {statement}
        <div
          className="border-2 border-dashed border-border"
          data-testid="home-events-empty"
        >
          <EmptyState
            variant="no-records"
            title={state.targeted ? T.empty.targeted : T.empty.general}
            {...(state.adjacentLink
              ? {
                  description: (
                    <>
                      {T.empty.adjacentLead}
                      <DsLink asChild variant="inline">
                        <Link
                          data-testid="home-events-adjacent"
                          href={config.routes.listing}
                        >
                          {T.empty.adjacentLink}
                        </Link>
                      </DsLink>
                    </>
                  ),
                }
              : {})}
          />
        </div>
      </>
    );
  }
  return (
    <>
      {statement}
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1" data-testid="home-events-cards">
          <NearestEventCards cards={state.cards} routes={config.routes} />
        </div>
        <aside className="lg:w-75 lg:flex-none" data-testid="home-events-month">
          <Suspense fallback={<SkeletonSlot className="h-85 w-full" />}>
            <CompactMonthSection
              config={config}
              raw={{}}
              feed={Promise.resolve(window)}
              request={request}
            />
          </Suspense>
        </aside>
      </div>
    </>
  );
}

/**
 * The doctor home's nearest-events block (017 EARS-9, wave-2 gate row 62,
 * §4.3 D11; the canvas `design-source/doctor-home.dc.html` «d-home ·
 * события»): «Ближайшие события» with «Все события →» into the host's events
 * page, then the nearest events as the feed's card unit beside the compact
 * month — general before a specialty is chosen, targeted after, through the
 * host's one feed read and its relayed specialty cookie (row 13).
 *
 * A host route mounts it with its host config only. The read streams behind
 * its own Suspense boundary, so the rest of the page (017's hero and specialty
 * catalog) renders and stays usable in every state: card skeletons while the
 * read is in flight, an honest `пусто`, or the cause with a working retry —
 * never an empty labelled box or an unresolving spinner (017 design §6).
 */
export async function HomeNearestEvents({
  config,
}: {
  config: EventsStorefrontHostConfig;
}) {
  const requestHeaders = await headers();
  const request: ReadRequest = {
    cookie: requestHeaders.get("cookie") ?? "",
    forwardedFor: requestHeaders.get("x-forwarded-for") ?? "",
  };
  const read = fetchNearestEvents(config, request);
  return (
    <section
      aria-labelledby="home-events-title"
      className="my-13 px-4 layout:my-23 layout:px-12"
      data-testid="home-events"
    >
      <div className="mx-auto w-full max-w-content">
        <div className="mb-4.5 flex flex-wrap items-end justify-between gap-4.5 layout:mb-7.5">
          <div>
            <Suspense fallback={<SkeletonSlot className="mb-2.5 h-3 w-24" />}>
              <NearestEventsKicker read={read} />
            </Suspense>
            <h2
              className="text-2xl font-extrabold leading-none tracking-tight text-foreground layout:text-4xl"
              id="home-events-title"
            >
              {T.title}
            </h2>
          </div>
          <DsLink asChild variant="inline">
            <Link data-testid="home-events-all" href={config.routes.listing}>
              {T.all}
            </Link>
          </DsLink>
        </div>
        <Suspense fallback={<NearestEventsSkeleton />}>
          <NearestEventsBody config={config} read={read} request={request} />
        </Suspense>
      </div>
    </section>
  );
}
