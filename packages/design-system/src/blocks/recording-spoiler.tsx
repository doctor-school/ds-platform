"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * 014 EARS-8 — the «Смотреть оригинал трансляции» SPOILER: the collapsible that
 * carries an event's SECONDARY cut under the main player. Source:
 * `design-source/webinar-archive.dc.html` L165-179 (the `showSpoiler` unit) —
 * a hairline-bordered strip under the player card whose summary is a bold line
 * plus a faint one-line hint, and whose body is the second player surface.
 *
 * It exists only for the both-cuts case (a montage AND the raw capture are
 * published). With a single published cut the host renders NOTHING here — the
 * absence is the product decision, so this block has no "empty" state to fall
 * back to and never renders a disabled or explanatory shell.
 *
 * Native `<details>/<summary>`, deliberately, and not a hand-rolled button:
 *   • keyboard operation (Tab to the summary, Enter/Space to toggle) and the
 *     expanded/collapsed state exposed to assistive tech come from the
 *     platform — an `aria-expanded` pair maintained by hand is a second
 *     implementation of a behaviour the browser already ships correctly;
 *   • no collapsible primitive exists in this package and no radix collapsible
 *     is a dependency, so the alternative was a new third-party dependency for
 *     a disclosure the platform already has.
 *
 * The body is mounted ONLY while open, which is why this is a client component
 * over an otherwise-static element. A `<details>` keeps its collapsed children
 * in the DOM, and the child here is a provider iframe: leaving it mounted would
 * fetch — and start counting a view on — a recording nobody asked to watch.
 * `open` is therefore React state fed by the element's own `toggle` event, so
 * the native control keeps driving the interaction and React only decides what
 * is rendered inside.
 *
 * ALL copy is injected; no string and no duration math live here.
 */
export interface RecordingSpoilerProps extends Omit<
  React.ComponentPropsWithoutRef<"details">,
  "children" | "open"
> {
  /** The bold summary line — «Смотреть оригинал трансляции» (from the catalog). */
  summaryLabel: string;
  /**
   * The faint one-line hint beside the label — «без монтажа, с паузами…».
   * Omitted/`null` renders NO hint line at all (hide-until-content).
   */
  hint?: string | null;
  /** Rendered only while the disclosure is open. */
  children: React.ReactNode;
  /** Start expanded. Defaults to collapsed — the canvas's resting state. */
  defaultOpen?: boolean;
}

const RecordingSpoiler = React.forwardRef<
  HTMLDetailsElement,
  RecordingSpoilerProps
>(
  (
    { className, summaryLabel, hint, children, defaultOpen = false, ...props },
    ref,
  ) => {
    const [open, setOpen] = React.useState(defaultOpen);

    return (
      <details
        ref={ref}
        open={open}
        // The native control stays the source of truth: the element toggles
        // itself, and React mirrors the result so the body can be mounted or
        // dropped. Reading `currentTarget.open` (not `!open`) keeps the two in
        // step even when the element is toggled from outside React.
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className={cn("border-2 border-hairline bg-card", className)}
        {...props}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3.5 px-4 py-4 hover:bg-tint layout:px-7 layout:py-[18px]">
          {/* The disclosure caret. Decorative: the expanded/collapsed state is
              already on the <details> for assistive tech. */}
          <span
            aria-hidden="true"
            className="text-sm font-extrabold text-foreground"
          >
            {open ? "▾" : "▸"}
          </span>
          <span className="text-sm font-extrabold text-foreground">
            {summaryLabel}
          </span>
          {hint ? (
            <span
              data-testid="recording-spoiler-hint"
              className="text-xs font-semibold text-muted-foreground"
            >
              {hint}
            </span>
          ) : null}
        </summary>
        {open ? (
          // The canvas caps the secondary player surface at 560px: the original
          // is the SUBORDINATE cut on this page, and rendering it at the main
          // player's full width would read as a second primary.
          <div className="max-w-[560px] px-4 pb-6 layout:px-7">{children}</div>
        ) : null}
      </details>
    );
  },
);
RecordingSpoiler.displayName = "RecordingSpoiler";

export { RecordingSpoiler };
