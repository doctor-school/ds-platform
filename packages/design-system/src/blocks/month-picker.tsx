import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist 12-month picker — the month view's month chooser (004 EARS-16/17,
 * source `design-source/webinars-month.dc.html`). A native `<details>` disclosure:
 * the `<summary>` shows the displayed month («Июль 2026 ▼»); the popover carries a
 * year ‹ › stepper and a 3-column grid of the year's twelve months, each with its
 * event count («142 эфира») — an already-past month is muted («прошёл»), the
 * displayed month is filled, every other month is a link to that month's view.
 *
 * A DISPLAY-ONLY unit — all data (the counts, the past/current flags), copy (the
 * month names, the count/«прошёл» notes, the accessible labels), and routing (the
 * per-month + year-step hrefs) are computed by the app and passed in. No client
 * state: the disclosure is native HTML, the navigation is plain `<a>` links
 * (server-component query-param paging, no mutation). Geometry lives HERE in the
 * SoT (the popover width, the cell paddings) off the app-forbidden arbitrary-value
 * scale; colour + type flow through tokens → light/dark flip automatically.
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

export interface MonthPickerProps {
  /** The `<summary>` trigger text — the displayed month, «Июль 2026». */
  triggerLabel: string;
  /** The picker region's accessible name («Выбрать месяц»). */
  pickerLabel: string;
  /** The displayed year, «2026». */
  year: string;
  /** The year ‹ › step targets (prev/next year of the displayed month). */
  prevYearHref: string;
  nextYearHref: string;
  /** Accessible names for the year ‹ › steps (the glyphs are decorative). */
  prevYearLabel: string;
  nextYearLabel: string;
  /** Exactly twelve month cells, January→December. */
  months: readonly MonthPickerCell[];
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

const MonthPicker = React.forwardRef<
  HTMLDetailsElement,
  MonthPickerProps & Omit<React.HTMLAttributes<HTMLDetailsElement>, "children">
>(
  (
    {
      triggerLabel,
      pickerLabel,
      year,
      prevYearHref,
      nextYearHref,
      prevYearLabel,
      nextYearLabel,
      months,
      defaultOpen,
      className,
      ...props
    },
    ref,
  ) => (
    <details
      ref={ref}
      open={defaultOpen}
      className={cn("relative", className)}
      {...props}
    >
      <summary
        aria-label={pickerLabel}
        className="flex list-none cursor-pointer items-center gap-3 border-2 border-primary-action bg-primary-action px-5 py-3.5 text-caption font-extrabold text-primary-foreground shadow-sm outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden"
      >
        {triggerLabel}
        <span aria-hidden="true" className="text-eyebrow">
          ▼
        </span>
      </summary>

      <div className="absolute left-0 top-[calc(100%+0.75rem)] z-20 w-[min(320px,84vw)] border-2 border-border bg-card p-5 shadow-lg layout:w-[340px]">
        {/* Year ‹ › stepper — steps the displayed month a whole year (±12). */}
        <div className="mb-3.5 flex items-center justify-between">
          <a
            href={prevYearHref}
            aria-label={prevYearLabel}
            className="px-2 text-caption font-extrabold text-foreground outline-none transition-colors hover:text-primary-action focus-visible:shadow-focus"
          >
            <span aria-hidden="true">‹</span>
          </a>
          <span className="text-caption font-extrabold tracking-wide text-foreground">
            {year}
          </span>
          <a
            href={nextYearHref}
            aria-label={nextYearLabel}
            className="px-2 text-caption font-extrabold text-foreground outline-none transition-colors hover:text-primary-action focus-visible:shadow-focus"
          >
            <span aria-hidden="true">›</span>
          </a>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {months.map((cell, i) => (
            <MonthCell key={i} cell={cell} />
          ))}
        </div>
      </div>
    </details>
  ),
);
MonthPicker.displayName = "MonthPicker";

export { MonthPicker };
