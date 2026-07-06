import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist day-band (#513, source §05 "Плашка дня" / §09). A full-bleed
 * section plate on the faint `section` surface that bands a day (or any grouping)
 * apart from the flat page without a card border — designed to `bleed` flush to
 * the cards it heads (the source's `day-band` space role = 0). Carries an uppercase
 * micro-label: 13px (`text-caption`) weight 800, `tracking-micro` (the normalised
 * +0.12em uppercase tracking), `foreground` ink. Padding `13px 24px`
 * (`py-3.25 px-6`), square. Token-only → `section` + ink flip per theme.
 */
const DayBand = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "bg-section px-6 py-3.25 text-caption font-extrabold uppercase tracking-micro text-foreground",
      className,
    )}
    {...props}
  />
));
DayBand.displayName = "DayBand";

export { DayBand };
