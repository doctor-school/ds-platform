import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Alert / callout — an inline status message (#513). Neo-brutalist (#511): a
 * hard 2px border in the status colour over a tinted surface, with a leading
 * status icon. Four variants map to the semantic status tokens:
 *   - `info`    → the brand `primary-action` on the pale `tint` surface.
 *   - `success` → `success` green.
 *   - `warn`    → functional `warning` amber (dark ink foreground — white fails
 *                 AA on amber).
 *   - `danger`  → `destructive` red.
 *
 * `role="alert"` announces the message. The status icon is decorative
 * (`aria-hidden`) — the variant's meaning is carried by the copy. Token-only.
 */
const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-none border-2 p-4 text-sm [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        info: "border-primary-action bg-tint text-foreground [&>svg]:text-primary-action",
        success:
          "border-success bg-tint text-foreground [&>svg]:text-success",
        warn: "border-warning bg-tint text-foreground [&>svg]:text-warning",
        danger:
          "border-destructive bg-tint text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

/** Decorative per-variant status glyph (inline SVG, aria-hidden). */
function AlertIcon({
  variant,
}: {
  variant: NonNullable<VariantProps<typeof alertVariants>["variant"]>;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (variant === "success") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (variant === "warn") {
    return (
      <svg {...common}>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (variant === "danger") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    );
  }
  // info
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, children, ...props }, ref) => {
    const v = variant ?? "info";
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant: v }), className)}
        {...props}
      >
        <AlertIcon variant={v} />
        <div className="flex min-w-0 flex-col gap-1">{children}</div>
      </div>
    );
  },
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("font-semibold leading-tight tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    // Inherit the alert's `text-foreground` (set on the container) rather than
    // dimming to `muted-foreground`: on the tinted alert surface the muted tier
    // risks dropping below AA in dark. The title's weight is the hierarchy.
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription, alertVariants };
