import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist badge (#513, source §05 "Бейдж «в эфире»" / "Спикер"). Two looks:
 *
 *   • `live`            a flat danger-red tag with a pulsing white dot — the
 *                       "в эфире" live indicator. Fill = `live` (#C81E1E,
 *                       INVARIANT across themes, source's `danger`/`live`
 *                       constant), copy + dot = `live-foreground` (white). The
 *                       leading 7px dot (`size-1.75`, the only round shape) pulses
 *                       on `animate-live-pulse` (1.6s). role defaults to `status`.
 *   • `label`/`speaker` the pale `tint` tag with `tint-foreground` copy (a meta
 *                       tag / speaker chip); identical visual, two names for intent.
 *
 * Shared: 11px micro-label → `text-2xs` weight 800, UPPERCASE, `tracking-micro`
 * (the foundation's normalised micro tracking, +0.12em), square. Token-only.
 */
const badgeVariants = cva(
  "inline-flex items-center text-2xs font-extrabold uppercase tracking-micro",
  {
    variants: {
      variant: {
        live: "gap-1.75 bg-live px-3 py-1.5 text-live-foreground",
        label: "bg-tint px-2.5 py-1.5 text-tint-foreground",
        speaker: "bg-tint px-2.5 py-1.5 text-tint-foreground",
      },
    },
    defaultVariants: { variant: "label" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "label", children, role, ...props }, ref) => (
    <span
      ref={ref}
      // A live badge is a status indicator — announce it politely by default
      // (overridable via `role`); the tint tags are inert labels.
      role={role ?? (variant === "live" ? "status" : undefined)}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {variant === "live" ? (
        <span
          aria-hidden="true"
          className="size-1.75 rounded-full bg-live-foreground animate-live-pulse"
        />
      ) : null}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
