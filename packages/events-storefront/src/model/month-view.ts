import type {
  DayAgendaRow,
  DotGridCell,
  MonthGridCell,
  MonthPickerCell,
  MonthPickerYear,
} from "@ds/design-system/blocks";
import {
  type MonthBroadcastEntry,
  type MonthlyEventCount,
  formatEventTime,
} from "@ds/schemas";

import { LISTING_COPY } from "../copy/listing-copy";
import type { PluralNoun } from "./event-count";
import {
  type MonthDayCell,
  type MonthGrid,
  capDayEntries,
  formatAgendaDayTitle,
  isMonthPast,
  monthShortLabels,
} from "./month-grid";

/**
 * The month view's block props from the one month model (wave-2 gate rows
 * 53–56) — the canvas kit's `gridWeeks` / `dotWeeks` / `agenda` / `pickerFor`
 * (`design-source/events-feed-kit.js`) over the read's entries, for both hosts.
 * Pure: hrefs come from the caller, copy from `LISTING_COPY.month`.
 */
const t = LISTING_COPY.month;

export interface MonthViewLinks {
  /** An event's page. */
  readonly event: (slug: string) => string;
  /** The feed moved to that day (row 53 «+N ещё», row 57). */
  readonly day: (isoDay: string) => string;
}

/** «time zone» in the viewer's zone, offline in МСК — the feed card rule (004). */
function pillTime(entry: MonthBroadcastEntry, viewerZone: string): string {
  const { time, zoneLabel } = formatEventTime({
    startsAt: entry.startsAt,
    participationFormat: entry.participationFormat,
    viewerZone,
  });
  return `${time} ${zoneLabel}`;
}

/** ≥1024 px: 7 columns, ≤3 pills «time zone · title» live first, «+N ещё» into the feed day. */
export function gridWeeksOf(
  grid: MonthGrid,
  links: MonthViewLinks,
  viewerZone: string,
): MonthGridCell[][] {
  return grid.weeks.map((week) =>
    week.map((cell, column): MonthGridCell => {
      if (!cell.inMonth || cell.isoDay === null) {
        return { dateLabel: String(cell.day), muted: true, mutedDate: true };
      }
      const { visible, overflow } = capDayEntries(cell.entries);
      return {
        dateLabel: cell.isToday ? `${cell.day}${t.todaySuffix}` : String(cell.day),
        today: cell.isToday,
        muted: column >= 5,
        mutedDate: cell.isPast,
        ...(visible.length > 0
          ? {
              pills: visible.map((entry) => ({
                href: links.event(entry.slug),
                time: pillTime(entry, viewerZone),
                title: entry.title,
                live: entry.state === "live",
                past: cell.isPast || isEnded(entry),
              })),
            }
          : {}),
        ...(overflow > 0
          ? { more: { href: links.day(cell.isoDay), label: t.moreLink(overflow) } }
          : {}),
      };
    }),
  );
}

function isEnded(entry: MonthBroadcastEntry): boolean {
  return entry.state === "ended" || entry.state === "in_archive";
}

/** The dot grid (below 1024 px, and the compact month of the feed column). */
export function dotWeeksOf(grid: MonthGrid, noun: PluralNoun): DotGridCell[][] {
  return grid.weeks.map((week) =>
    week.map((cell): DotGridCell => {
      const entries = cell.inMonth ? cell.entries : [];
      return {
        day: cell.day,
        inMonth: cell.inMonth,
        today: cell.isToday,
        dots: capDayEntries(entries).visible.map((entry) =>
          entry.state === "live"
            ? "live"
            : cell.isPast || isEnded(entry)
              ? "past"
              : "event",
        ),
        ariaLabel:
          cell.isoDay === null
            ? String(cell.day)
            : [
                formatAgendaDayTitle(cell.isoDay),
                entries.length > 0 ? t.dayEventsLabel(entries.length, noun) : null,
              ]
                .filter(Boolean)
                .join(", "),
      };
    }),
  );
}

/** The agenda of one tapped day (row 55). */
export interface AgendaDay {
  title: string;
  rows: DayAgendaRow[];
  emptyText: string;
}

export function agendaDaysOf(
  grid: MonthGrid,
  links: MonthViewLinks,
  noun: PluralNoun,
  viewerZone: string,
): Record<number, AgendaDay> {
  const days: Record<number, AgendaDay> = {};
  for (const cell of grid.weeks.flat()) {
    if (!cell.inMonth || cell.isoDay === null) continue;
    days[cell.day] = {
      title: `${formatAgendaDayTitle(cell.isoDay)}${cell.isToday ? t.todaySuffix : ""}`,
      emptyText: t.agendaEmpty(noun),
      rows: cell.entries.map((entry) => ({
        href: links.event(entry.slug),
        time: pillTime(entry, viewerZone),
        school: entry.school,
        title: entry.title,
        live: entry.state === "live",
        liveLabel: t.agendaLive,
      })),
    };
  }
  return days;
}

/** The day the agenda opens on: today in the current month, else the month's first event day. */
export function defaultAgendaDay(grid: MonthGrid): number {
  if (grid.todayDom !== null) return grid.todayDom;
  const first = grid.weeks
    .flat()
    .find((cell: MonthDayCell) => cell.inMonth && cell.entries.length > 0);
  return first?.day ?? 1;
}

/** The picker's years: each month's count, «архив» for an empty past month, muted when empty (row 54). */
export function pickerYearsOf(
  counts: readonly (readonly [string, readonly MonthlyEventCount[]])[],
  displayed: string,
  noun: PluralNoun,
  monthLink: (month: string) => string,
  /** The page's one today (D10) — «архив» marks a month before its month. */
  today: string,
): MonthPickerYear[] {
  const labels = monthShortLabels();
  return counts.map(([year, rows]) => {
    const byMonth = new Map(rows.map((row) => [row.month, row.count]));
    const months: MonthPickerCell[] = labels.map((label, i) => {
      const month = `${year}-${String(i + 1).padStart(2, "0")}`;
      const count = byMonth.get(i + 1) ?? 0;
      const current = month === displayed;
      return {
        label,
        note:
          count > 0
            ? t.pickerCount(count, noun)
            : isMonthPast(month, today)
              ? t.pickerPast
              : t.pickerEmpty(noun),
        current,
        muted: count === 0,
        ...(current ? {} : { href: monthLink(month) }),
      };
    });
    return { year, months };
  });
}
