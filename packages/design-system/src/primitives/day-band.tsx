import * as React from "react";

import { cn } from "../lib/utils";

/**
 * DayBand — a full-bleed section label plate (#513). Heads a day in the webinars
 * schedule with a hard, brand-coloured plate: the `primary-surface` fill, white
 * uppercase micro-label typography, a 2px hard border — the neo-brutalist band
 * that separates one day's sessions from the next.
 *
 * Renders as a heading (`h2` by default; override the level via `as` to keep the
 * document outline correct) so the schedule's day boundaries are real landmarks
 * for assistive tech, not decorative text.
 */
export interface DayBandProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level for the section label. Defaults to `h2`. */
  as?: "h2" | "h3" | "h4";
}

const DayBand = React.forwardRef<HTMLHeadingElement, DayBandProps>(
  ({ className, as: Comp = "h2", children, ...props }, ref) => (
    <Comp
      ref={ref}
      className={cn(
        "flex w-full items-center rounded-none border-2 border-border bg-primary-surface px-4 py-2",
        // `primary-surface` is blue.700 in BOTH themes (a fixed brand plate), so
        // it must carry the always-white brand-chrome foreground — NOT
        // `primary-foreground`, which flips to dark ink in dark mode (that pairs
        // with the light `primary-action` fill, not this fixed brand surface) and
        // would fail AA (dark-blue on blue.700).
        "text-sm font-extrabold uppercase tracking-wider text-header-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  ),
);
DayBand.displayName = "DayBand";

export { DayBand };
