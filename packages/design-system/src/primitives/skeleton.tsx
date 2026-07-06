import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist loading skeleton (#513, source §08 "Скелетон загрузки"). A
 * `hairline`-filled block that pulses on `animate-skeleton-pulse` (1.4s, the
 * shared `live-pulse` keyframe; neutralised under `prefers-reduced-motion`).
 * Square (radius 0). Compose ANY shape by passing size utilities via `className`
 * (the source shows a 56×56 square avatar + 12px lines at 60/85/40% width).
 * Decorative → `aria-hidden`; wrap a loading region in an `aria-busy` container.
 * Token-only → the `hairline` fill flips per theme automatically.
 */
const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn("bg-hairline animate-skeleton-pulse", className)}
    {...props}
  />
));
Skeleton.displayName = "Skeleton";

export { Skeleton };
