import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist alert / callout (#513, source §08 "Обратная связь"). A hard 2px
 * square frame in the semantic colour on the matching tint surface, a leading icon
 * in the semantic colour, and ink body copy (13.5px → `text-sm`, line-height 1.5,
 * a bold lead-in supported). Padding `14px 16px` (`py-3.5 px-4`), gap 12 (`gap-3`),
 * icon 15px (`text-body-compact`), items flex-start.
 *
 * Four variants and their token pairs (source colours, light/dark auto-flip):
 *   • info     `info` (blue.500→blue.300) border+icon on `tint`         → role=status
 *   • success  `success` (green.500→green.400) on `success-tint`        → role=status
 *   • warn     `warning` (amber.500→amber.400) on `warning-tint`        → role=alert
 *   • danger   `live` (#C81E1E, INVARIANT) on `destructive-tint`        → role=alert
 *
 * FIDELITY NOTE: danger paints `live`, NOT `destructive`. The source keeps the
 * danger red at #C81E1E in BOTH themes (its `danger` constant) — which the `live`
 * role carries invariant. The `destructive` FILL is also #C81E1E in both themes
 * (since #537), but it is the interactive-fill role (button / invalid input), a
 * distinct semantic from this non-text alert border/icon, so `live` is the correct
 * token here.
 */
const alertVariants = cva(
  "flex items-start gap-3 border-2 px-4 py-3.5",
  {
    variants: {
      variant: {
        info: "border-info bg-tint",
        success: "border-success bg-success-tint",
        warn: "border-warning bg-warning-tint",
        danger: "border-live bg-destructive-tint",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

/** Per-variant leading glyph, its semantic colour, and ARIA live-region role. */
const VARIANT_META: Record<
  AlertVariant,
  { glyph: string; iconClass: string; role: "status" | "alert" }
> = {
  info: { glyph: "ⓘ", iconClass: "text-info", role: "status" },
  success: { glyph: "✓", iconClass: "text-success", role: "status" },
  warn: { glyph: "⚠", iconClass: "text-warning", role: "alert" },
  danger: { glyph: "✕", iconClass: "text-live", role: "alert" },
};

export interface AlertProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", role, children, ...props }, ref) => {
    const meta = VARIANT_META[variant ?? "info"];
    return (
      <div
        ref={ref}
        role={role ?? meta.role}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 text-body-compact leading-none",
            meta.iconClass,
          )}
        >
          {meta.glyph}
        </span>
        <div className="text-sm leading-normal text-foreground [&_b]:font-bold">
          {children}
        </div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

export { Alert, alertVariants };
