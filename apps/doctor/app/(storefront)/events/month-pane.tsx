"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@ds/design-system/button";
import { MonthDotGrid } from "@ds/design-system/blocks";
import {
  DOCTOR_EVENTS_MONTH_COPY,
  type DoctorEventsMonthPane,
} from "@/lib/events-month-grid";

/**
 * 019 EARS-4 (#1519) — the month calendar standing BESIDE the day feed as
 * navigation over the same targeted read (F-019-2 Б).
 *
 * The ONE reason this is a client component: EARS-4 requires selecting a day to
 * move the feed body «by changing the URL per LD-1 WITHOUT a full-page reload of
 * the shell». A bare `<a href>` in the App Router is a document navigation and
 * would remount 017's shell on every day click, so the selection goes through
 * `router.push` — a soft navigation that re-renders the server route, keeps the
 * shell mounted, writes the day into the address bar and leaves the back button
 * walking the feed's own states. There is no local selection state here: the
 * selected day is read from the URL upstream and handed in, so the calendar and
 * the feed cannot disagree about which day is showing.
 *
 * The month step links are ordinary `next/link` links inside the design-system
 * `Button` (`asChild`) — a month step has no shell-remount constraint and stays
 * a real, shareable link. All geometry, dots, today tint and selected fill come
 * from the shared `MonthDotGrid`; this file adds only the header row and the
 * routing the unit's contract leaves to its host.
 */
export function DoctorEventsMonthPaneView({
  pane,
}: {
  pane: DoctorEventsMonthPane;
}) {
  const router = useRouter();

  return (
    <nav
      aria-label={DOCTOR_EVENTS_MONTH_COPY.paneLabel}
      className="border-2 border-border bg-card shadow-lg"
      data-events-month=""
      data-month={pane.month}
      data-selected-day={pane.selectedDay ?? ""}
    >
      <div className="flex items-center justify-between gap-2 border-b-2 border-border p-3">
        <span className="text-caption font-extrabold text-foreground">
          {pane.monthLabel}
        </span>
        <span className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <NextLink
              aria-label={DOCTOR_EVENTS_MONTH_COPY.prevMonth}
              data-testid="events-month-prev"
              href={pane.prevMonthHref}
            >
              ‹
            </NextLink>
          </Button>
          <Button asChild size="sm" variant="outline">
            <NextLink
              aria-label={DOCTOR_EVENTS_MONTH_COPY.nextMonth}
              data-testid="events-month-next"
              href={pane.nextMonthHref}
            >
              ›
            </NextLink>
          </Button>
        </span>
      </div>

      <MonthDotGrid
        className="mt-0 border-0 shadow-none"
        onSelectDay={(day) => {
          const href = pane.dayHrefs[day];
          if (href) router.push(href, { scroll: false });
        }}
        selectedDay={pane.selectedDay}
        weekdays={pane.weekdays}
        weeks={pane.weeks}
      />
    </nav>
  );
}
