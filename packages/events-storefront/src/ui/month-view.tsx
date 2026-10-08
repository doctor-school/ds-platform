import Link from "next/link";
import { MonthPicker } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import type { RawQueryRecord } from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import { LISTING_COPY, eventNounOf } from "../copy/listing-copy";
import { type EventsStorefrontHostConfig, eventPageHref } from "../host-config";
import { hasAppliedFacets } from "../model/facets";
import { emptyFeedState } from "../model/feed";
import { dayHref, monthHref } from "../model/feed-url";
import {
  buildMonthGrid,
  currentMskMonth,
  formatMonthTitle,
  isMonthFuture,
  shiftMonth,
  weekdayShortLabels,
} from "../model/month-grid";
import { defaultAgendaDay, pickerYearsOf } from "../model/month-view";
import { type ReadRequest, fetchMonthCounts, fetchMonthEntries } from "../server";
import { BlockError } from "./block-error";
import { EmptyFeedBlock } from "./feed-list";
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
 * offer of the feed.
 */
export async function MonthView({
  config,
  raw,
  month,
  request,
}: {
  config: EventsStorefrontHostConfig;
  raw: RawQueryRecord;
  month: string | undefined;
  request: ReadRequest;
}) {
  const t = LISTING_COPY.month;
  const noun = eventNounOf(config.copy);
  const listing = config.routes.listing;
  const displayed = month ?? currentMskMonth();
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
          years={pickerYearsOf(counts, displayed, noun, at)}
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
          <Link href={at(undefined)} data-testid="month-today">
            {t.todayButton}
          </Link>
        </Button>
      </div>
    </div>
  );

  const body = (() => {
    if (!entries.ok) {
      return (
        <BlockError
          title={t.errorTitle}
          description={t.errorBody}
          testId="events-month-error"
        />
      );
    }
    if (entries.value.length === 0 && hasAppliedFacets(raw, config.filterSet)) {
      return (
        <EmptyFeedBlock
          testId="events-month-empty"
          empty={emptyFeedState(raw, { listing, noun, copy: FEED_COPY })}
        />
      );
    }
    const grid = buildMonthGrid({ month: displayed, entries: entries.value });
    const hrefs: MonthHrefs = {
      event: Object.fromEntries(
        entries.value.map((e) => [e.slug, eventPageHref(config, e.slug)]),
      ),
      day: Object.fromEntries(
        grid.weeks
          .flat()
          .flatMap((cell) =>
            cell.inMonth && cell.isoDay !== null
              ? [[cell.isoDay, dayHref(listing, raw, cell.isoDay)]]
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
            {...(isMonthFuture(displayed)
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

  return (
    <section className="flex flex-col gap-7" data-testid="events-month-view">
      {nav}
      {body}
    </section>
  );
}
