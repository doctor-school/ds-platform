import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist selected-day agenda — mobile pane (004 EARS-19, source
 * `design-source/webinars-month.dc.html`, ≤900px). The list of the selected day's
 * events below the {@link MonthDotGrid}: each row is a link to the event page
 * (time · school · title), a `live` row carries the red «LIVE» badge + red border
 * and red time; an empty day shows the past-/future-appropriate note.
 *
 * A PRESENTATION unit — the app owns the day's data, the copy (the heading, the
 * «LIVE» + empty labels), and the routing; geometry (the `52px` time column, the
 * row paddings) lives HERE off the app-forbidden computed-dimension scale.
 */

/** One agenda row — a link to its event page. */
export interface DayAgendaRow {
  href: string;
  /** МСК start time, e.g. `19:00`. */
  time: string;
  /** School / series kicker. */
  school: string;
  /** Event title. */
  title: string;
  /** Whether the event is airing now — the red «LIVE» row treatment (EARS-9 parity). */
  live?: boolean;
  /** «LIVE» badge copy (from the catalog); rendered only on a `live` row. */
  liveLabel: string;
}

export interface DayAgendaProps {
  /** The day heading — «16 июля, среда» (+ the app-appended «· сегодня» when today). */
  title: string;
  /** The selected day's event rows, nearest-first. */
  rows: readonly DayAgendaRow[];
  /** The note shown when the day has no events (past-day vs future-day copy — app-chosen). */
  emptyText: string;
}

const DayAgenda = React.forwardRef<
  HTMLDivElement,
  DayAgendaProps & React.HTMLAttributes<HTMLDivElement>
>(({ title, rows, emptyText, className, ...props }, ref) => (
  <div ref={ref} className={className} {...props}>
    <div className="mt-[26px] mb-4 flex items-baseline gap-3.5">
      <span className="text-caption font-extrabold uppercase tracking-micro whitespace-nowrap text-foreground">
        {title}
      </span>
      <span aria-hidden="true" className="flex-1 border-t-2 border-foreground" />
    </div>

    {rows.length > 0 ? (
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <li key={i}>
            <a
              href={row.href}
              className={cn(
                "flex items-start gap-4 border-2 bg-card p-4 no-underline shadow-sm outline-none focus-visible:shadow-focus",
                row.live ? "border-live" : "border-border",
              )}
            >
              <span className="flex min-w-[52px] flex-none flex-col items-center">
                {row.live ? (
                  <span className="mb-0.5 bg-live px-1.5 py-0.5 text-2xs font-extrabold tracking-wide text-live-foreground">
                    {row.liveLabel}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "text-[16px] font-extrabold tabular-nums tracking-[-0.02em]",
                    // AA on `bg-card` (#270): blue.500 (`info`) fails contrast, so
                    // non-live time takes blue.700 (`primary-action`). For the red
                    // LIVE time use `destructive-text` (the red TEXT token, which
                    // flips to the AA-safe lighter red in dark) — NOT `live`, which
                    // is the surface red meant to pair with white, and fails as text
                    // on the dark card.
                    row.live ? "text-destructive-text" : "text-primary-action",
                  )}
                >
                  {row.time}
                </span>
              </span>
              <span className="min-w-0">
                <span className="mb-1 block text-eyebrow font-extrabold uppercase tracking-micro text-primary-action">
                  {row.school}
                </span>
                <span className="block text-[14.5px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground">
                  {row.title}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    ) : (
      <div className="border-2 border-dashed border-border p-6 text-center text-caption font-semibold text-muted-foreground">
        {emptyText}
      </div>
    )}
  </div>
));
DayAgenda.displayName = "DayAgenda";

export { DayAgenda };
