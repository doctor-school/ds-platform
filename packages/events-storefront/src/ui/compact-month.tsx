"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DotGridCell, MonthDotGrid } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";

import { LISTING_COPY } from "../copy/listing-copy";

/**
 * The compact month of the feed column (wave-2 gate row 56, the canvas
 * «компактный месяц»): the month name with ‹ ›, and the dot grid whose day
 * click moves the feed to that day without a shell reload — a soft push of
 * the day href (row 57: a day beyond the served extent widens the read),
 * then `DayAnchorScroll` scrolls to the day's group.
 */
export function CompactMonth({
  month,
  title,
  weekdays,
  weeks,
  selectedDay,
  prevHref,
  nextHref,
  dayHrefs,
}: {
  /** The displayed month, `YYYY-MM`. */
  month: string;
  title: string;
  weekdays: string[];
  weeks: DotGridCell[][];
  selectedDay: number | null;
  prevHref: string;
  nextHref: string;
  /** The feed moved to each in-month day, keyed by day-of-month. */
  dayHrefs: Record<number, string>;
}) {
  const router = useRouter();
  const t = LISTING_COPY.month;
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="events-compact-month"
      data-month={month}
      data-selected-day={selectedDay ?? undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-extrabold uppercase tracking-micro">
          {title}
        </span>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={prevHref}
              scroll={false}
              aria-label={t.prevMonth}
              data-testid="events-compact-month-prev"
            >
              <span aria-hidden="true">‹</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link
              href={nextHref}
              scroll={false}
              aria-label={t.nextMonth}
              data-testid="events-compact-month-next"
            >
              <span aria-hidden="true">›</span>
            </Link>
          </Button>
        </div>
      </div>
      <MonthDotGrid
        weekdays={weekdays}
        weeks={weeks}
        selectedDay={selectedDay}
        onSelectDay={(day) => {
          const href = dayHrefs[day];
          if (href) router.push(href, { scroll: false });
        }}
      />
    </div>
  );
}
