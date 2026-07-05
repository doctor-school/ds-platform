import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Container — the page-shell layout primitive of the container/rhythm system
 * (#514, canvas §09). It centres content (`margin-inline: auto`), caps the
 * reading width, and applies the responsive page gutter:
 *
 *   - Mobile (< the `desktop` breakpoint, 901px): edge-to-edge shell with a
 *     FIXED 16px gutter (`--layout-gutter-mobile`).
 *   - Desktop (≥ 901px): the container width caps and the gutter becomes the
 *     FLUID `--layout-gutter` clamp (16→48px).
 *
 * Two widths, by role: `content` (1104px, the reading column) and `calendar`
 * (1240px, the wider schedule/calendar surface). Every value flows from a token
 * — the primitive carries no bespoke dimension.
 *
 * `asChild` (Radix Slot) lets the shell BE the semantic element (`<main>`,
 * `<section>`) rather than an extra wrapper `<div>`.
 */
const containerVariants = cva(
  // margin-auto + full-width + mobile-first gutter; the `desktop:` gutter swap
  // rides the `--breakpoint-desktop` token variant. Paren utilities resolve the
  // layout custom properties (design-system SoT — arbitrary values are allowed
  // here, forbidden in apps/*).
  "mx-auto w-full px-(--layout-gutter-mobile) desktop:px-(--layout-gutter)",
  {
    variants: {
      variant: {
        content: "max-w-(--layout-container-content)",
        calendar: "max-w-(--layout-container-calendar)",
      },
    },
    defaultVariants: { variant: "content" },
  },
);

export interface ContainerProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof containerVariants> {
  /** Render as the single child element (Radix Slot) instead of a `<div>`. */
  asChild?: boolean;
}

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="container"
        data-variant={variant ?? "content"}
        className={cn(containerVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
Container.displayName = "Container";

export { Container, containerVariants };
