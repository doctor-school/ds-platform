import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist month dot-grid — mobile pane (004 EARS-19, source
 * `design-source/webinars-month.dc.html`, ≤900px). A compact month calendar where
 * each day carries up to three status DOTS (a red dot for an airing event, an
 * accent dot for a planned one, a muted dot for an already-past day); tapping a
 * day selects it and drives the {@link DayAgenda} below. Today is tinted, the
 * selected day filled. The dots are a navigation aid — the authoritative,
 * screen-reader-accessible per-event detail (incl. the «LIVE» text mark) lives in
 * the agenda; each day button also carries an `aria-label` summary so the live
 * signal is never colour-only (WCAG 1.4.1).
 *
 * A controlled PRESENTATION unit: the selected day + the selection handler are
 * owned by the app (the mobile view holds the state and composes this with the
 * agenda); geometry lives HERE (the `52px` cell, the `6px` dots) off the
 * app-forbidden computed-dimension scale.
 */

/** A day's status-dot kinds (max three shown), driving the dot colour. */
export type DotKind = "live" | "event" | "past";

/** One day cell of the dot-grid. */
export interface DotGridCell {
  /** The day-of-month number shown. */
  day: number;
  /** `true` for the shown month's own days; a neighbour-month filler otherwise (non-interactive). */
  inMonth: boolean;
  /** Today's cell — tinted. */
  today?: boolean;
  /** The status dots (already capped at three by the caller). */
  dots: readonly DotKind[];
  /** The accessible summary for the day button («16 июля, 2 эфира, идёт эфир»). */
  ariaLabel: string;
}

export interface MonthDotGridProps {
  /** The 7 Monday-first weekday header labels. */
  weekdays: readonly string[];
  /** Monday-first weeks, each exactly 7 cells. */
  weeks: readonly (readonly DotGridCell[])[];
  /** The currently-selected in-month day (its cell is filled); `null` selects none. */
  selectedDay: number | null;
  /** Selection handler — the app updates its selected-day state + the agenda. */
  onSelectDay: (day: number) => void;
}

function Dot({ kind, selected }: { kind: DotKind; selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 rounded-full",
        kind === "live"
          ? "bg-live"
          : kind === "past"
            ? "bg-muted-2 opacity-[0.55]"
            : selected
              ? "bg-primary-foreground"
              : "bg-info",
      )}
    />
  );
}

const MonthDotGrid = React.forwardRef<
  HTMLDivElement,
  MonthDotGridProps & React.HTMLAttributes<HTMLDivElement>
>(({ weekdays, weeks, selectedDay, onSelectDay, className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "mt-4 border-2 border-border bg-card shadow-lg",
      className,
    )}
    {...props}
  >
    <div className="grid grid-cols-7 border-b-2 border-border">
      {weekdays.map((name) => (
        <span
          key={name}
          className="py-2 text-center text-2xs font-extrabold uppercase tracking-[0.06em] text-muted-foreground"
        >
          {name}
        </span>
      ))}
    </div>

    {weeks.map((week, wi) => (
      <div key={wi} className="grid grid-cols-7">
        {week.map((cell, ci) => {
          const selected = cell.inMonth && cell.day === selectedDay;
          return (
            <button
              key={ci}
              type="button"
              disabled={!cell.inMonth}
              aria-pressed={cell.inMonth ? selected : undefined}
              aria-label={cell.ariaLabel}
              onClick={cell.inMonth ? () => onSelectDay(cell.day) : undefined}
              className={cn(
                "flex min-h-[52px] flex-col items-center gap-[5px] border-0 pt-2 pb-[7px] outline-none focus-visible:shadow-focus disabled:cursor-default",
                selected
                  ? "bg-primary-action"
                  : cell.today
                    ? "bg-tint"
                    : "bg-transparent",
              )}
            >
              <span
                className={cn(
                  "text-[15px] font-extrabold leading-none tabular-nums",
                  selected
                    ? "text-primary-foreground"
                    : cell.today
                      ? "text-primary-action"
                      : !cell.inMonth
                        ? "text-muted-foreground"
                        : "text-foreground",
                )}
              >
                {cell.day}
              </span>
              <span className="flex h-1.5 items-center justify-center gap-[3px]">
                {cell.dots.map((kind, di) => (
                  <Dot key={di} kind={kind} selected={selected} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    ))}
  </div>
));
MonthDotGrid.displayName = "MonthDotGrid";

export { MonthDotGrid };
