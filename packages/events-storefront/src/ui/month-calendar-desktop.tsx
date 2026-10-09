"use client";

import type { ComponentProps } from "react";
import { MonthCalendarGrid } from "@ds/design-system/blocks";

import type { MonthGrid } from "../model/month-grid";
import { type MonthViewLinks, gridWeeksOf } from "../model/month-view";
import { useViewerZone } from "./use-viewer-zone";

/** The month's hrefs, pre-computed on the server (functions cannot cross to the client). */
export interface MonthHrefs {
  /** Event page by slug. */
  readonly event: Record<string, string>;
  /** The feed moved to that day, by `YYYY-MM-DD`. */
  readonly day: Record<string, string>;
}

export function linksOf(hrefs: MonthHrefs): MonthViewLinks {
  return {
    event: (slug) => hrefs.event[slug] ?? "",
    day: (isoDay) => hrefs.day[isoDay] ?? "",
  };
}

/**
 * The month view at ≥1024 px (wave-2 gate row 53, the canvas «сетка месяца»):
 * the pill grid, its pill times in the viewer's zone like the feed cards
 * (server render and hydration read МСК, then the browser zone swaps in).
 */
export function MonthCalendarDesktop({
  grid,
  hrefs,
  ...gridProps
}: Omit<ComponentProps<typeof MonthCalendarGrid>, "weeks"> & {
  grid: MonthGrid;
  hrefs: MonthHrefs;
}) {
  const viewerZone = useViewerZone();
  return (
    <MonthCalendarGrid
      {...gridProps}
      weeks={gridWeeksOf(grid, linksOf(hrefs), viewerZone)}
    />
  );
}
