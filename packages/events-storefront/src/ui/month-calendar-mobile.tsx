"use client";

import { useState } from "react";
import { DayAgenda, MonthDotGrid } from "@ds/design-system/blocks";

import type { PluralNoun } from "../model/event-count";
import type { MonthGrid } from "../model/month-grid";
import { agendaDaysOf, dotWeeksOf } from "../model/month-view";
import { type MonthHrefs, linksOf } from "./month-calendar-desktop";
import { useViewerZone } from "./use-viewer-zone";

/**
 * The month view below 1024 px (wave-2 gate row 55, the canvas «месяц
 * точками»): the dot grid and the agenda of the tapped day. The selected day
 * is the one client state of the month view — tapping a day swaps the agenda,
 * no navigation. Agenda times follow the viewer's zone like the feed cards.
 */
export function MonthCalendarMobile({
  weekdays,
  grid,
  hrefs,
  noun,
  defaultDay,
}: {
  weekdays: string[];
  grid: MonthGrid;
  hrefs: MonthHrefs;
  noun: PluralNoun;
  /** The day the agenda opens on. */
  defaultDay: number;
}) {
  const viewerZone = useViewerZone();
  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const agenda = agendaDaysOf(grid, linksOf(hrefs), noun, viewerZone)[selectedDay];
  return (
    <div className="flex flex-col gap-6" data-testid="month-calendar-mobile">
      <MonthDotGrid
        weekdays={weekdays}
        weeks={dotWeeksOf(grid, noun)}
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
