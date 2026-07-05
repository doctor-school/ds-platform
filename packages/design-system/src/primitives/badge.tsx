import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Badge — a small non-interactive status/label token (#513). Neo-brutalist
 * (#511): a hard 2px border, 0 radius, uppercase micro-label typography.
 *
 * Variants:
 *   - `live` — a broadcasting indicator: destructive red (`#C81E1E` =
 *     `--color-destructive`), UPPERCASE, preceded by a pulsing dot. Used to flag
 *     a webinar that is on air.
 *   - `label` / `speaker` — the tonal `tint` surface (blue.100 / blue.700), for
 *     category tags and speaker chips. Two aliases of the same tint skin so the
 *     call site reads by intent.
 *
 * Token-only styling; the pulsing dot uses the core `animate-pulse` utility
 * (the "livePulse" shimmer), which the layer-1 base reset neutralises under
 * `prefers-reduced-motion`.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-none border-2 px-2 py-0.5 text-2xs font-extrabold uppercase tracking-wider",
  {
    variants: {
      variant: {
        live: "border-destructive bg-background text-destructive",
        label: "border-tint-foreground bg-tint text-tint-foreground",
        speaker: "border-tint-foreground bg-tint text-tint-foreground",
      },
    },
    defaultVariants: {
      variant: "label",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {variant === "live" ? (
        // Decorative pulsing dot — the status word carries the meaning, so the
        // dot is hidden from assistive tech.
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-destructive animate-pulse"
        />
      ) : null}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
