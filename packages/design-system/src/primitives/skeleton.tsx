import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Skeleton — a loading placeholder block (#513). A decorative `livePulse`
 * shimmer (the core `animate-pulse` opacity pulse) on the `muted` surface,
 * neo-brutalist 0-radius. Compose several to sketch a loading card/list.
 *
 * `aria-hidden` — a skeleton is a purely visual placeholder; assistive tech is
 * told the region is busy elsewhere (an `aria-busy` container), not by narrating
 * the shimmer. The pulse is neutralised under `prefers-reduced-motion` by the
 * layer-1 base reset. Size/shape come from the caller's `className`.
 */
const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn("animate-pulse rounded-none bg-muted", className)}
    {...props}
  />
));
Skeleton.displayName = "Skeleton";

export { Skeleton };
