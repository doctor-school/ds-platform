import * as React from "react";

import { cn } from "../lib/utils";
import { Link } from "../primitives/link";

/**
 * Neo-brutalist month-calendar grid — desktop pane (004 EARS-19, source
 * `design-source/webinars-month.dc.html`). A DISPLAY-ONLY 7-column month grid:
 * each in-month day renders its events as pills (`time · title`, linking to the
 * event page), a red live pill for an airing event, or a muted aggregate note on
 * an already-past day; today is outlined; weekends/empty days take the faint
 * surface. A state legend sits below the grid.
 *
 * A PRESENTATION unit only — all data (the МСК day bucketing, the today/past
 * flags), copy (the pill/day labels, legend + live labels), and routing (the pill
 * hrefs) are computed by the app and passed in. Geometry lives HERE in the SoT
 * (the `840px` min-width, `118px` cell height, the pill/day paddings) — the
 * app-scoped `no-arbitrary-tailwind-value` gate forbids those computed dimensions
 * in `apps/*`. Colour + type flow through tokens → light/dark flip automatically.
 * The grid scrolls horizontally on a narrow desktop viewport (`overflow-x-auto`),
 * never squeezing the 7 columns below their legible width.
 */

/** One event pill in a day cell — links to the event page (`/webinars/:slug`, EARS-8). */
export interface MonthGridPill {
  href: string;
  /** МСК start time, e.g. `19:00`. */
  time: string;
  /** Event title. */
  title: string;
  /** Whether the event is airing now — renders the red live pill (EARS-9 parity). */
  live?: boolean;
}

/** One day cell of the desktop grid. */
export interface MonthGridCell {
  /** The day label — a bare number, or the app-composed «16 · сегодня» for today. */
  dateLabel: string;
  /** Today's cell — outlined, with the date on a filled chip. */
  today?: boolean;
  /** A weekend / empty / neighbour-month cell — the faint surface + muted date ink. */
  muted?: boolean;
  /** The date ink reads muted (past / weekend / empty / neighbour day). */
  mutedDate?: boolean;
  /** Event pills for a today/future day — the app caps these at 3, live-first. */
  pills?: MonthGridPill[];
  /**
   * The «+N ещё» overflow link when the day carries more events than the
   * 3-pill cap (canvas update 2026-07-17) — targets the week listing anchored
   * at the day's group.
   */
  more?: { href: string; label: string };
  /** The muted aggregate note for an already-past day («2 эфира · прошли»). */
  note?: string;
}

export interface MonthCalendarGridProps {
  /** The 7 Monday-first weekday header labels («пн»…«вс»). */
  weekdays: readonly string[];
  /** Monday-first weeks, each exactly 7 cells. */
  weeks: readonly (readonly MonthGridCell[])[];
  /** Live-signal copy — «В эфире» (screen-reader label on a red pill; the pulsing dot is the visible cue). */
  liveLabel: string;
  /** The three legend labels — airing / planned / past-or-empty. */
  legend: { live: string; planned: string; past: string };
  /**
   * The bottom-right accent link to the nearest FUTURE month with events
   * (canvas line 155, «Декабрь 2026 →») — omitted when no later month of the
   * displayed year carries events.
   */
  nextMonthLink?: { href: string; label: string };
}

/**
 * The pulsing round live dot (mirrors the webinar-card signal); decorative — the
 * sr-only label carries the meaning. INLINE in the pill's single text run
 * (canvas line 240: the live prefix is an in-text glyph, not a left column), so
 * multi-line pill text wraps around it instead of centring beside it.
 */
function LiveDot() {
  return (
    <span
      aria-hidden="true"
      className="mr-1.5 inline-block size-1.5 rounded-full bg-live-foreground animate-live-pulse"
    />
  );
}

function LegendSwatch({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-3 shrink-0", className)} />;
}

const MonthCalendarGrid = React.forwardRef<
  HTMLDivElement,
  MonthCalendarGridProps & React.HTMLAttributes<HTMLDivElement>
>(({ weekdays, weeks, liveLabel, legend, nextMonthLink, className, ...props }, ref) => (
  <div ref={ref} className={className} {...props}>
    <div className="mt-7 overflow-x-auto border-2 border-border bg-card shadow-lg">
      <div className="min-w-[840px]">
        {/* Weekday header. Display-only calendar → NO ARIA grid roles: an
            incomplete grid/row/gridcell chain fails `aria-required-parent`, and
            the semantics add nothing over the visible layout (the pills are
            links, the dates are text). Weekday ink is the AA-safe quiet tier
            (`text-muted-foreground`, #270) — the fainter `muted-2`/`faint`
            neutral-400/500 fails contrast on `bg-card`. */}
        <div className="grid grid-cols-7 border-b-2 border-border">
          {weekdays.map((name) => (
            <span
              key={name}
              className="p-3 text-eyebrow font-extrabold uppercase tracking-micro text-muted-foreground"
            >
              {name}
            </span>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid grid-cols-7 border-b border-hairline last:border-b-0"
          >
            {week.map((cell, ci) => (
              <div
                key={ci}
                className={cn(
                  "min-h-[118px] border-r border-hairline p-2.5 last:border-r-0",
                  cell.muted && "bg-section",
                  cell.today &&
                    "relative outline outline-[3px] -outline-offset-[3px] outline-primary-action",
                )}
              >
                <span
                  className={cn(
                    "text-caption font-extrabold",
                    cell.today
                      ? "bg-primary-action px-2 py-0.5 text-primary-foreground"
                      : cell.mutedDate
                        ? "text-muted-foreground"
                        : "text-foreground",
                  )}
                >
                  {cell.dateLabel}
                </span>

                <div className="mt-0.5">
                  {/* Canvas lines 234–235: a BLOCK pill whose text is one inline
                      run `{time} · {title}` — it wraps inside the pill and never
                      leaks past the cell (the #1052 overflow defect came from
                      the flex row keeping the text span at content width). */}
                  {(cell.pills ?? []).map((pill, pi) => (
                    <a
                      key={pi}
                      href={pill.href}
                      className={cn(
                        "mt-1.5 block px-2 py-1.5 text-eyebrow leading-[1.35] break-words no-underline outline-none focus-visible:shadow-focus",
                        pill.live
                          ? "bg-live font-extrabold text-live-foreground"
                          : "bg-tint font-bold text-tint-foreground",
                      )}
                    >
                      {pill.live ? (
                        <>
                          <LiveDot />
                          <span className="sr-only">{liveLabel}</span>
                        </>
                      ) : null}
                      {pill.time} · {pill.title}
                    </a>
                  ))}

                  {cell.more ? (
                    <a
                      href={cell.more.href}
                      className="mt-1.5 block px-2 py-1 text-eyebrow font-extrabold text-tint-foreground underline decoration-2 underline-offset-3 outline-none focus-visible:shadow-focus"
                    >
                      {cell.more.label}
                    </a>
                  ) : null}

                  {cell.note ? (
                    <span className="mt-1.5 block text-eyebrow font-semibold text-muted-foreground">
                      {cell.note}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>

    {/* Legend row — canvas lines 149–156: the three labelled swatches left
        (WCAG 1.4.1: colour is never the only cue), the accent link to the
        nearest future month with events bottom-right. */}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
      <div
        data-testid="grid-legend"
        className="flex flex-wrap items-center gap-5 text-xs font-bold text-muted-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <LegendSwatch className="bg-live" />
          {legend.live}
        </span>
        <span className="inline-flex items-center gap-2">
          <LegendSwatch className="bg-tint" />
          {legend.planned}
        </span>
        <span className="inline-flex items-center gap-2">
          <LegendSwatch className="border border-hairline bg-section" />
          {legend.past}
        </span>
      </div>
      {nextMonthLink ? (
        <Link
          variant="inline"
          href={nextMonthLink.href}
          data-testid="next-month-link"
          className="text-caption font-bold"
        >
          {nextMonthLink.label}
        </Link>
      ) : null}
    </div>
  </div>
));
MonthCalendarGrid.displayName = "MonthCalendarGrid";

export { MonthCalendarGrid };
