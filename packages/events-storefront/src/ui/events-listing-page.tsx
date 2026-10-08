import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { Link as DsLink } from "@ds/design-system/link";
import { type RawQueryRecord, rawQueryScalar } from "@ds/schemas";

import { LISTING_COPY, eventNounOf } from "../copy/listing-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  type SpecialtyChoice,
  filterOptionsOf,
} from "../model/facets";
import type { BlockRead, EventsFeedPage } from "../model/feed";
import {
  canonicalFeedRedirect,
  dayHref,
  feedTenseOf,
  monthHref,
  pageMonthOf,
  pageViewOf,
  tenseHref,
  viewHref,
} from "../model/feed-url";
import {
  buildMonthGrid,
  currentMskMonth,
  formatMonthTitle,
  shiftMonth,
  weekdayShortLabels,
} from "../model/month-grid";
import { dotWeeksOf } from "../model/month-view";
import {
  type ReadRequest,
  fetchEventsFeed,
  fetchMonthEntries,
  fetchSpecialtyChoices,
  forwardedSessionFrom,
} from "../server";
import { CompactMonth } from "./compact-month";
import { FacetPanel, FacetSheet } from "./facet-panel";
import { FeedFrame } from "./feed-frame";
import {
  CountedSubline,
  FeedSection,
  FeedSkeleton,
  LiveSection,
  LiveSkeleton,
  MyEventsSection,
  MyEventsSkeleton,
  SkeletonSlot,
  readMyEvents,
} from "./feed-sections";
import { MonthView } from "./month-view";

type FeedRead = Promise<BlockRead<EventsFeedPage>>;

interface PanelInput {
  config: EventsStorefrontHostConfig;
  raw: RawQueryRecord;
  feed: FeedRead;
  specialties: Promise<SpecialtyChoice[]>;
}

/** The page's facet options and labels: the feed read's option block + the specialty book. */
async function panelOptions({ config, feed, specialties }: PanelInput) {
  const [read, book] = await Promise.all([feed, specialties]);
  const block = read.ok ? read.value.facetOptions : {};
  return {
    options: filterOptionsOf(config.filterSet, block, book),
    optionBlock: block,
  };
}

/** The column's facet panel (≥1024 px, row 56). */
export async function FacetColumn(input: PanelInput) {
  return (
    <FacetPanel
      filterSet={input.config.filterSet}
      listing={input.config.routes.listing}
      raw={input.raw}
      {...(await panelOptions(input))}
    />
  );
}

/** «Фильтры (N)» and its sheet (below 1024 px, row 60). */
export async function FacetSheetSection(input: PanelInput) {
  const [read, panel] = await Promise.all([input.feed, panelOptions(input)]);
  return (
    <FacetSheet
      filterSet={input.config.filterSet}
      listing={input.config.routes.listing}
      raw={input.raw}
      {...panel}
      matching={read.ok ? read.value.matching : null}
      noun={eventNounOf(input.config.copy)}
    />
  );
}

/**
 * The compact month above the facet panel in the feed view (row 56): the
 * displayed month's dots under the page's facets; a day click moves the feed
 * to that day, widening the served extent when the day lies beyond it (row
 * 57). A failed month read drops the compact month, never the feed.
 */
export async function CompactMonthSection({
  config,
  raw,
  feed,
  request,
}: {
  config: EventsStorefrontHostConfig;
  raw: RawQueryRecord;
  feed: FeedRead;
  request: ReadRequest;
}) {
  const month = pageMonthOf(raw) ?? currentMskMonth();
  const [entries, read] = await Promise.all([
    fetchMonthEntries(config, raw, month, request),
    feed,
  ]);
  if (!entries.ok) return null;
  const listing = config.routes.listing;
  const horizon = read.ok ? read.value.horizon : undefined;
  const grid = buildMonthGrid({ month, entries: entries.value });
  const day = rawQueryScalar(raw.day);
  const dayHrefs: Record<number, string> = {};
  for (const cell of grid.weeks.flat()) {
    if (cell.inMonth && cell.isoDay !== null) {
      dayHrefs[cell.day] = dayHref(listing, raw, cell.isoDay, horizon);
    }
  }
  return (
    <CompactMonth
      month={month}
      title={formatMonthTitle(month)}
      weekdays={weekdayShortLabels()}
      weeks={dotWeeksOf(grid, eventNounOf(config.copy))}
      selectedDay={
        day !== undefined && day.startsWith(month)
          ? Number(day.slice(8, 10))
          : grid.todayDom
      }
      prevHref={monthHref(listing, raw, shiftMonth(month, -1))}
      nextHref={monthHref(listing, raw, shiftMonth(month, 1))}
      dayHrefs={dayHrefs}
    />
  );
}

/** The month view's grid skeleton (row 49, the canvas «месяц · загрузка»). */
export function MonthSkeleton() {
  return (
    <div
      className="grid grid-cols-7 gap-0.5 border-2 border-hairline p-0.5"
      data-testid="events-month-skeleton"
    >
      {Array.from({ length: 35 }, (_, i) => (
        <SkeletonSlot key={i} className="h-12 w-full lg:h-28" />
      ))}
    </div>
  );
}

/**
 * THE events page of both storefronts (wave-2 entry gate §2.4–§2.5, the #2076
 * canvas `design-source/events-feed.dc.html`): a host route file mounts it
 * with its host config only (gate §5). One page, two views in one URL codec
 * (row 51): the feed («Идёт сейчас» → «Мои события» → the day feed) and the
 * month (`view=month`). At ≥1024 px a sticky left column holds the compact
 * month (feed view) above the host's facet panel; below it «Фильтры (N)»
 * opens the panel as a sheet (rows 52, 56, 60). The view switch «Календарь на
 * месяц →» / «← Лента событий» keeps the tense and the facets.
 *
 * A legacy Academy URL (`tab`, `cursor`, `cursorTrail`, `page`) answers a
 * permanent redirect to its canonical form (§4.3 D1). Every read is uncached
 * and lifecycle-sensitive, so the mounting route declares
 * `dynamic = "force-dynamic"` (segment config cannot live here).
 */
export async function EventsListingPage({
  config,
  searchParams,
}: {
  config: EventsStorefrontHostConfig;
  searchParams: Promise<RawQueryRecord>;
}) {
  const raw = await searchParams;
  const listing = config.routes.listing;
  const canonical = canonicalFeedRedirect(listing, raw);
  if (canonical !== null) permanentRedirect(canonical);

  const view = pageViewOf(raw);
  const tense = feedTenseOf(raw);
  const requestHeaders = await headers();
  const session = forwardedSessionFrom(requestHeaders);
  const request: ReadRequest = {
    cookie: requestHeaders.get("cookie") ?? "",
    forwardedFor: requestHeaders.get("x-forwarded-for") ?? "",
  };
  // One feed read serves the day feed, the counted subline, the facet
  // options and the sheet's «Показать N» — in either view.
  const feed = fetchEventsFeed(config, raw, request);
  const specialties: Promise<SpecialtyChoice[]> =
    config.filterSet === "doctor"
      ? fetchSpecialtyChoices()
      : Promise.resolve([]);
  const mine = readMyEvents(config.contentSet.myEventsPath, session);

  const switchHref = viewHref(
    listing,
    raw,
    view === "month" ? "feed" : "month",
  );
  const switchLabel =
    view === "month" ? LISTING_COPY.view.toFeed : LISTING_COPY.view.toMonth;
  const { subline } = config.headerCopy;
  const panel: PanelInput = { config, raw, feed, specialties };

  return (
    <FeedFrame
      title={config.headerCopy.title}
      subline={
        typeof subline === "string" ? (
          subline
        ) : (
          <Suspense
            fallback={<SkeletonSlot className="inline-block h-4 w-48" />}
          >
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
        upcoming: tenseHref(listing, raw, "upcoming"),
        past: tenseHref(listing, raw, "past"),
      }}
      headAction={
        <div className="hidden lg:block">
          <DsLink asChild tone="on-primary" variant="inline">
            <Link data-testid="events-view-switch" href={switchHref}>
              {switchLabel}
            </Link>
          </DsLink>
        </div>
      }
    >
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
        <aside
          className="hidden lg:sticky lg:top-4 lg:flex lg:w-75 lg:flex-none lg:flex-col lg:gap-7"
          data-testid="events-column"
        >
          {view === "feed" ? (
            <Suspense fallback={<SkeletonSlot className="h-85 w-full" />}>
              <CompactMonthSection
                config={config}
                raw={raw}
                feed={feed}
                request={request}
              />
            </Suspense>
          ) : null}
          <Suspense fallback={<SkeletonSlot className="h-96 w-full" />}>
            <FacetColumn {...panel} />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <Suspense fallback={<SkeletonSlot className="h-11 w-36" />}>
              <FacetSheetSection {...panel} />
            </Suspense>
            <DsLink asChild variant="inline">
              <Link data-testid="events-view-switch-narrow" href={switchHref}>
                {switchLabel}
              </Link>
            </DsLink>
          </div>
          {view === "month" ? (
            <Suspense fallback={<MonthSkeleton />}>
              <MonthView
                config={config}
                raw={raw}
                month={pageMonthOf(raw)}
                feed={feed}
                request={request}
              />
            </Suspense>
          ) : (
            <>
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
                  query={raw}
                  feed={feed}
                  mine={mine}
                />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </FeedFrame>
  );
}
