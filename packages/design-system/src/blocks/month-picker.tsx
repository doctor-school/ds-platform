"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "../primitives/button";

/**
 * Neo-brutalist 12-month picker — the month view's month chooser (004 EARS-16/17,
 * source `design-source/webinars-month.dc.html`). A native `<details>` disclosure:
 * the `<summary>` trigger shows the displayed month («Июль 2026 ▼»); the popover
 * carries a year ‹ › stepper and a 3-column grid of the year's twelve months, each
 * with its event count («142 эфира») — an already-past month is muted («прошёл»),
 * the displayed month is filled, every other month is a link to that month's view.
 *
 * IN-PLACE year paging (004 owner verdict #4 on #1052): the year ‹ › stepper pages
 * the mini-calendar CLIENT-SIDE across a server-provided window of years — the
 * popover stays open, the month cells + counters swap for the stepped year, and NO
 * navigation fires. The window is bounded (the app hands in a fixed span of years,
 * each with its 12 precomputed cells); stepping PAST the window edge falls back to
 * a real server-navigation link (`prev/nextYearHref`) that re-centres the window on
 * the year just beyond the current edge (never a re-centre on the year already in
 * view) so reach stays unbounded while every in-window step is instant and loss-free.
 *
 * The trigger + steppers adopt the `Button` primitive's `outline` state machinery
 * (hover / active-press / focus-visible), so on the navy hero the trigger reads as
 * a white bordered control consistent with the ‹ › month pager (004 owner verdicts
 * #1/#2 on #1052) — never a low-contrast filled-blue summary. Geometry that is not
 * the primitive's (the popover width, the cell paddings) lives HERE in the SoT off
 * the app-forbidden arbitrary-value scale; colour + type flow through tokens →
 * light/dark flip automatically.
 */

/** One month cell of the picker grid. */
export interface MonthPickerCell {
  /** Short month name («Янв»…«Дек»). */
  label: string;
  /** The note under the name — the count («142 эфира») or the past marker («прошёл»). */
  note: string;
  /** Link target for the month's view; omitted for the displayed month (non-interactive). */
  href?: string;
  /** The displayed month — filled, non-interactive (the "you are here" marker). */
  current?: boolean;
  /** An already-past МСК month — muted ink, no chip border (still navigable). */
  muted?: boolean;
}

/** One year of the provided paging window — its label and its twelve month cells. */
export interface MonthPickerYear {
  /** The year, «2026». */
  year: string;
  /** Exactly twelve month cells, January→December, precomputed for THIS year. */
  months: readonly MonthPickerCell[];
}

export interface MonthPickerProps {
  /** The `<summary>` trigger text — the displayed month, «Июль 2026». */
  triggerLabel: string;
  /** The picker region's accessible name («Выбрать месяц»). */
  pickerLabel: string;
  /**
   * The server-provided year window (ascending) the ‹ › stepper pages across
   * without navigation. Must contain `initialYear`.
   */
  years: readonly MonthPickerYear[];
  /** The initially displayed year, «2026» — the window entry the picker opens on. */
  initialYear: string;
  /**
   * Edge-fallback server-navigation targets: followed only when the ‹ › step
   * would leave the provided window (a whole-year ±12-month shift that re-renders
   * the pane with a re-centred window).
   */
  prevYearHref: string;
  nextYearHref: string;
  /** Accessible names for the year ‹ › steps (the glyphs are decorative). */
  prevYearLabel: string;
  nextYearLabel: string;
  /** Render the disclosure open (the showcase / axe scan — otherwise closed by default). */
  defaultOpen?: boolean;
}

/** One month cell — a link (navigable) or a span (the displayed month). */
function MonthCell({ cell }: { cell: MonthPickerCell }) {
  const body = (
    <>
      <span className="block text-caption font-extrabold">{cell.label}</span>
      <span className="mt-0.5 block text-eyebrow font-semibold">{cell.note}</span>
    </>
  );
  const base = "block px-1.5 py-2.5 text-center border-2 outline-none";
  if (cell.current) {
    return (
      <span
        aria-current="true"
        className={cn(
          base,
          "border-primary-action bg-primary-action text-primary-foreground",
        )}
      >
        {body}
      </span>
    );
  }
  return (
    <a
      href={cell.href}
      className={cn(
        base,
        "transition-colors focus-visible:shadow-focus",
        cell.muted
          ? "border-transparent text-muted-foreground hover:border-chip-border"
          : "border-chip-border text-tint-foreground hover:bg-tint",
      )}
    >
      {body}
    </a>
  );
}

/**
 * The year ‹ › step control — a real `<button>` while the step stays inside the
 * provided window (client state, popover stays open), or an `<a>` at the window
 * edge (server navigation re-centres the window). Both adopt the `outline` button
 * states (hover / active-press / focus-visible).
 */
function YearStep({
  glyph,
  label,
  atEdge,
  edgeHref,
  onStep,
}: {
  glyph: string;
  label: string;
  atEdge: boolean;
  edgeHref: string;
  onStep: () => void;
}) {
  const className = buttonVariants({ variant: "outline", size: "sm" });
  if (atEdge) {
    return (
      <a href={edgeHref} aria-label={label} className={className}>
        <span aria-hidden="true">{glyph}</span>
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} className={className} onClick={onStep}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

const MonthPicker = React.forwardRef<
  HTMLDetailsElement,
  MonthPickerProps & Omit<React.HTMLAttributes<HTMLDetailsElement>, "children">
>(
  (
    {
      triggerLabel,
      pickerLabel,
      years,
      initialYear,
      prevYearHref,
      nextYearHref,
      prevYearLabel,
      nextYearLabel,
      defaultOpen,
      className,
      ...props
    },
    ref,
  ) => {
    const [year, setYear] = React.useState(initialYear);
    // Resync the client year to the server-provided `initialYear` whenever it
    // changes — a sibling soft-navigation re-renders this component with a new
    // displayed year while the popover may still be open; without this the
    // mount-seeded state would show a stale year (004 owner verdict #6 on #1052).
    React.useEffect(() => {
      setYear(initialYear);
    }, [initialYear]);
    const idx = years.findIndex((y) => y.year === year);
    // Fall back to the initial year if state drifts out of the window (defensive).
    const activeIdx = idx >= 0 ? idx : years.findIndex((y) => y.year === initialYear);
    const active = years[activeIdx] ?? years[0];
    const atStart = activeIdx <= 0;
    const atEnd = activeIdx >= years.length - 1;

    return (
      <details
        ref={ref}
        open={defaultOpen}
        // `flex flex-col` so the `<summary>` trigger can fill the height the
        // toolbar's `items-stretch` row hands the `<details>` wrapper — without
        // it the summary sat at its own shorter content height inside a stretched
        // box and rendered SHORTER than the sibling ‹ › / «Сегодня» controls
        // (004 owner verdict #6 on #1052).
        className={cn("relative flex flex-col", className)}
        {...props}
      >
        <summary
          aria-label={pickerLabel}
          className={cn(
            buttonVariants({ variant: "outline" }),
            // The trigger keeps its own layout: full-width in the toolbar cell,
            // `h-full` so it fills the stretched wrapper (matching the neighbour
            // controls' rendered height), the month label pushed left of the
            // disclosure caret, native marker hidden. It reads as a WHITE bordered
            // control on the navy hero (owner verdicts #1/#2) — the `outline`
            // surface + border.
            "h-full w-full cursor-pointer justify-between gap-3 text-caption font-extrabold [&::-webkit-details-marker]:hidden",
          )}
        >
          {triggerLabel}
          <span aria-hidden="true" className="text-eyebrow">
            ▼
          </span>
        </summary>

        <div className="absolute left-0 top-[calc(100%+0.75rem)] z-20 w-[min(320px,84vw)] border-2 border-border bg-card p-5 shadow-lg layout:w-[340px]">
          {/* Year ‹ › stepper — pages the picker a whole year IN PLACE across the
              provided window; at the edge it server-navigates (±12 months). */}
          <div className="mb-3.5 flex items-center justify-between">
            <YearStep
              glyph="‹"
              label={prevYearLabel}
              atEdge={atStart}
              edgeHref={prevYearHref}
              onStep={() => setYear(years[activeIdx - 1]!.year)}
            />
            <span
              data-testid="month-picker-year"
              className="text-caption font-extrabold tracking-wide text-foreground"
            >
              {active?.year}
            </span>
            <YearStep
              glyph="›"
              label={nextYearLabel}
              atEdge={atEnd}
              edgeHref={nextYearHref}
              onStep={() => setYear(years[activeIdx + 1]!.year)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(active?.months ?? []).map((cell, i) => (
              <MonthCell key={i} cell={cell} />
            ))}
          </div>
        </div>
      </details>
    );
  },
);
MonthPicker.displayName = "MonthPicker";

export { MonthPicker };
