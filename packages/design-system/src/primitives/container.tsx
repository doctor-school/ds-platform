import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * §09 «Раскладка и ритм» layout container (source `design-system.dc.html` §09
 * «Контейнер» / «Брейкпоинты»). Centres the page content column and owns the
 * responsive gutter + breakpoint behaviour so surfaces never re-derive it by eye:
 *
 *   • **Mobile (≤ 900px)** — edge-to-edge: NO max-width cap, a fixed 16px gutter
 *     (`px-4`). The fixed gutter is what lets a day-band plate or a card bleed to
 *     the viewport edge (`-mx-gutter` / `-mx-4`) cleanly near the breakpoint.
 *   • **Desktop (≥ 901px, the `layout:` variant)** — the column caps to its
 *     max-width (`content` 1104px / `calendar` 1240px), centres (`mx-auto`), and
 *     the gutter widens to the `clamp(16px, 4vw, 48px)` recipe (`layout:px-gutter`);
 *     the offset shadows then sit clear of the viewport edge.
 *
 * Two `variant`s: `content` (default — article / list / form / detail surfaces,
 * 1104px) and `calendar` (the wider calendar surfaces, 1240px). Token-only — the
 * widths, gutter and breakpoint all resolve to the generated §09 tokens
 * (`--container-*`, `--spacing-gutter`, `--breakpoint-layout`). Square, radius-0.
 */
const containerVariants = cva("mx-auto w-full px-4 layout:px-gutter", {
  variants: {
    variant: {
      content: "layout:max-w-content",
      calendar: "layout:max-w-calendar",
    },
  },
  defaultVariants: { variant: "content" },
});

export interface ContainerProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof containerVariants> {}

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, variant = "content", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(containerVariants({ variant }), className)}
      {...props}
    />
  ),
);
Container.displayName = "Container";

export { Container, containerVariants };
