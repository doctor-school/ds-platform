"use client";

import { useState } from "react";
import {
  DayAgenda,
  MonthDotGrid,
  type DayAgendaRow,
  type DotGridCell,
} from "@ds/design-system/blocks";

/**
 * 004 EARS-19 — the mobile pane's client shell (≤900px). The dot-grid + agenda
 * selection is the ONLY interactive/presentation state on the month view (design
 * §5.4: day selection is client-side, no navigation, no mutation), so it is the
 * single «use client» island; the desktop grid and all data/copy/routing stay in
 * the server component. Everything here is pre-computed and serialisable — the
 * island only tracks which day is selected and swaps the agenda below the grid.
 */

/** The pre-composed agenda for one in-month day (title + rows + empty note). */
export interface AgendaDay {
  title: string;
  rows: DayAgendaRow[];
  emptyText: string;
}

export interface MonthCalendarMobileProps {
  weekdays: string[];
  weeks: DotGridCell[][];
  /** Per-in-month-day agenda, keyed by day-of-month. */
  days: Record<number, AgendaDay>;
  /** The initially-selected day (today МСК, or the month's first day). */
  defaultDay: number;
  className?: string;
}

export function MonthCalendarMobile({
  weekdays,
  weeks,
  days,
  defaultDay,
  className,
}: MonthCalendarMobileProps) {
  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const agenda = days[selectedDay];

  return (
    <div className={className} data-testid="month-calendar-mobile">
      <MonthDotGrid
        weekdays={weekdays}
        weeks={weeks}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />
      {agenda ? (
        <DayAgenda
          data-testid="day-agenda"
          title={agenda.title}
          rows={agenda.rows}
          emptyText={agenda.emptyText}
        />
      ) : null}
    </div>
  );
}
