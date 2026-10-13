import Link from "next/link";
import { MonthPicker } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import type { MonthBroadcastEntry, RawQueryRecord } from "@ds/schemas";

import { LISTING_COPY, eventNounOf } from "../copy/listing-copy";
import { type EventsStorefrontHostConfig, eventPageHref } from "../host-config";
import { type SpecialtyChoice, hasAppliedFacets } from "../model/facets";
import {
  type BlockRead,
  type EventsFeedHorizon,
  type EventsFeedPage,
  type FeedFacetOptions,
  pageTodayOf,
} from "../model/feed";
import { dayHref, feedTenseOf, monthHref } from "../model/feed-url";
import {
  buildMonthGrid,
  formatMonthTitle,
  isMonthFuture,
  shiftMonth,
  weekdayShortLabels,
} from "../model/month-grid";
import {
  defaultAgendaDay,
  defaultDisplayedMonth,
  pickerYearsOf,
} from "../model/month-view";
import { type ReadRequest, fetchMonthCounts, fetchMonthEntries } from "../server";
import { BlockError } from "./block-error";
import { BlockRetry } from "./block-retry";
import type { EventsBlockRetryAction, EventsBlockRetryInput } from "./events-block-retry";
import { EmptyFeedBlock } from "./feed-list";
import { type SpecialtyBook, readEmptyFeedState } from "./feed-sections";
import { MonthCalendarDesktop, type MonthHrefs } from "./month-calendar-desktop";
import { MonthCalendarMobile } from "./month-calendar-mobile";

/**
 * The picker's in-place year window: the displayed year ± 3 (004 owner
 * verdicts #4/#6 on #1052) — a step past the edge server-navigates.
 */
const PICKER_YEAR_RADIUS = 3;

/**
 * The month view of the one events page (wave-2 gate rows 51–55, the #2076
 * canvas «месяц · навигация» / «сетка месяца» / «месяц точками»): the picker
 * with per-month counts, ‹ › and «Сегодня»; at ≥1024 px the pill grid, below
 * it the dot grid with the tapped day's agenda. Both reads take the page's
 * facets, so the month narrows as the feed does; a failed read shows its
 * cause and «Повторить», an empty month under a facet the empty-by-filter
 * offer of the feed. A day's «+N ещё» (and the dot grid's agenda link) takes
 * the one day-href rule over the served feed extent (rows 53, 57).
 */
export async function MonthView({
  config,
  raw,
  month,
  feed,
  specialties,
  request,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  raw: RawQueryRecord;
  month: string | undefined;
  feed: Promise<BlockRead<EventsFeedPage>>;
  /** The specialty book — read only to name a picked specialty in the empty state. */
  specialties: Promise<readonly SpecialtyChoice[]>;
  request: ReadRequest;
  /** The host's block retry: the failed grid's «Повторить» re-runs the month read alone. */
  retry: EventsBlockRetryAction;
}) {
  const t = LISTING_COPY.month;
  const noun = eventNounOf(config.copy);
  const listing = config.routes.listing;
  // D10 — the page's one today is the feed read's: the default month, the
  // grid's today and past days, «архив» and the day-href tense boundary.
  const read = await feed;
  const today = pageTodayOf(read);
  // «Прошедшие» opens on its latest past event's month, «Будущие» on today's;
  // so on «Прошедшие» «Сегодня» names today's month rather than the default.
  const tense = feedTenseOf(raw);
  const displayed = month ?? defaultDisplayedMonth(read, tense, today);
  const todayMonth = tense === "past" ? today.slice(0, 7) : undefined;
  const at = (target: string | undefined) => monthHref(listing, raw, target);
  const year = Number(displayed.slice(0, 4));
  const years = Array.from(
    { length: PICKER_YEAR_RADIUS * 2 + 1 },
    (_, i) => String(year - PICKER_YEAR_RADIUS + i),
  );

  const [entries, counts] = await Promise.all([
    fetchMonthEntries(config, raw, displayed, request),
    Promise.all(
      years.map(async (y) => {
        const read = await fetchMonthCounts(config, raw, y, request);
        // A far year that fails to count reads as zeros; the grid states the
        // month's own failure.
        return [y, read.ok ? read.value : []] as const;
      }),
    ),
  ]);

  const prev = shiftMonth(displayed, -1);
  const next = shiftMonth(displayed, 1);
  const nav = (
    <div className="flex items-stretch gap-3" data-testid="month-toolbar">
      <div className="flex min-w-0 max-w-70 flex-1">
        <MonthPicker
          key={displayed}
          className="w-full"
          triggerLabel={formatMonthTitle(displayed)}
          pickerLabel={t.pickerLabel}
          initialYear={String(year)}
          years={pickerYearsOf(counts, displayed, noun, at, today)}
          prevYearHref={at(shiftMonth(displayed, -12 * (PICKER_YEAR_RADIUS + 1)))}
          nextYearHref={at(shiftMonth(displayed, 12 * (PICKER_YEAR_RADIUS + 1)))}
          prevYearLabel={t.prevYear}
          nextYearLabel={t.nextYear}
        />
      </div>
      {/* Default size, not `icon`: the four toolbar controls share one height (004 owner verdict #6). */}
      <Button asChild variant="outline">
        <Link href={at(prev)} aria-label={t.prevMonth} data-testid="month-prev">
          <span aria-hidden="true">‹</span>
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={at(next)} aria-label={t.nextMonth} data-testid="month-next">
          <span aria-hidden="true">›</span>
        </Link>
      </Button>
      <div className="hidden lg:flex">
        <Button asChild variant="outline">
          <Link href={at(todayMonth)} data-testid="month-today">
            {t.todayButton}
          </Link>
        </Button>
      </div>
    </div>
  );

  const body = await MonthGridBlock({
    config,
    raw,
    month: displayed,
    today,
    horizon: read.ok ? read.value.horizon : undefined,
    facetOptions: read.ok ? read.value.facetOptions : {},
    entries,
    specialties: () => specialties,
    request,
    retry,
  });

  return (
    <section className="flex flex-col gap-7" data-testid="events-month-view">
      {nav}
      {body}
    </section>
  );
}

/**
 * The month view's grid — the one block of the month view its «Повторить»
 * re-renders (019 EARS-9, #2832): the displayed month's entries as the pill
 * grid (≥1024 px) and the dot grid (below), the block's own failure with its
 * retry, or the empty-by-filter offer. Everything it takes from the page's
 * feed read (today, the served extent, the facet titles) arrives as data, so a
 * retry re-runs the month read alone.
 */
export async function MonthGridBlock({
  config,
  raw,
  month: displayed,
  today,
  horizon,
  facetOptions,
  entries,
  specialties,
  request,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  raw: RawQueryRecord;
  /** The displayed month, `YYYY-MM`. */
  month: string;
  /** The page's one today (D10), `YYYY-MM-DD`. */
  today: string;
  /** The feed read's served extent; absent when that read failed. */
  horizon: EventsFeedHorizon | undefined;
  /** The feed read's facet titles — the empty state names a facet by them. */
  facetOptions: FeedFacetOptions;
  entries: BlockRead<MonthBroadcastEntry[]>;
  /** The specialty book, read only when the empty state names a specialty. */
  specialties: SpecialtyBook;
  request: ReadRequest;
  retry: EventsBlockRetryAction;
}) {
  const t = LISTING_COPY.month;
  const noun = eventNounOf(config.copy);
  const listing = config.routes.listing;
  const at = (target: string | undefined) => monthHref(listing, raw, target);
  const prev = shiftMonth(displayed, -1);
  const next = shiftMonth(displayed, 1);

  // An empty month under a facet offers the feed's widening, counted over the
  // tense's whole reach (the canvas rule), its facets named by the read's titles.
  const empty =
    entries.ok && entries.value.length === 0 && hasAppliedFacets(raw, config.filterSet)
      ? await readEmptyFeedState(config, raw, facetOptions, specialties, request)
      : null;

  return (() => {
    if (!entries.ok) {
      const input: EventsBlockRetryInput = {
        block: "month",
        raw,
        month: displayed,
        today,
        ...(horizon === undefined ? {} : { horizon }),
        facetOptions,
      };
      return (
        <BlockRetry retry={retry.bind(null, input)}>
          <BlockError
            title={t.errorTitle}
            description={t.errorBody}
            testId="events-month-error"
          />
        </BlockRetry>
      );
    }
    if (empty !== null) {
      return <EmptyFeedBlock testId="events-month-empty" empty={empty} />;
    }
    const grid = buildMonthGrid({ month: displayed, entries: entries.value, today });
    const hrefs: MonthHrefs = {
      event: Object.fromEntries(
        entries.value.map((e) => [e.slug, eventPageHref(config, e.slug)]),
      ),
      day: Object.fromEntries(
        grid.weeks
          .flat()
          .flatMap((cell) =>
            cell.inMonth && cell.isoDay !== null
              ? [[cell.isoDay, dayHref(listing, raw, cell.isoDay, horizon, today)]]
              : [],
          ),
      ),
    };
    return (
      <>
        <div className="hidden lg:block">
          <MonthCalendarDesktop
            data-testid="month-grid-desktop"
            weekdays={weekdayShortLabels()}
            grid={grid}
            hrefs={hrefs}
            liveLabel={t.liveLabel}
            legend={{ live: t.legendLive, planned: t.legendPlanned, past: t.legendPast }}
            nextMonthLink={{ href: at(next), label: t.nextMonthLink(formatMonthTitle(next)) }}
            {...(isMonthFuture(displayed, today)
              ? { prevMonthLink: { href: at(prev), label: t.prevMonthLink(formatMonthTitle(prev)) } }
              : {})}
          />
        </div>
        <div className="lg:hidden">
          <MonthCalendarMobile
            weekdays={weekdayShortLabels()}
            grid={grid}
            hrefs={hrefs}
            noun={noun}
            defaultDay={defaultAgendaDay(grid)}
          />
        </div>
      </>
    );
  })();
}
