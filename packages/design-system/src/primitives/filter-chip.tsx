"use client";

import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

/**
 * FilterChip — a toggleable selection chip for faceted filtering (webinars
 * category/speaker filters, #513). Built on `@radix-ui/react-toggle`, so Radix
 * owns the `aria-pressed` / `data-state` toggle semantics and keyboard toggle
 * for free; we only supply the neo-brutalist token skin (#511).
 *
 * States (issue #513):
 *   - rest: hard 2px `border` frame on the flat page, ink text.
 *   - hover: the pale `tint` surface + a `tint-foreground` border (the pressed
 *     preview tone) — the affordance the interaction-states contract requires.
 *   - selected (`data-state=on`): the `primary-action` fill (btn-bg) with its
 *     white foreground — the same weight as a filled primary button.
 *   - disabled: dimmed via the shared `interactiveBase` `disabled:opacity-50`.
 *
 * Token-only: no arbitrary Tailwind values (§5). Composes `interactiveBase` for
 * the focus-visible ring so it satisfies the layer-2 clickable contract.
 */
const FilterChip = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>
>(({ className, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(
      interactiveBase,
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none border-2 border-border bg-background px-3 py-1 text-sm font-medium text-foreground",
      "disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      // hover preview — tint surface + tint-foreground border
      "hover:border-tint-foreground hover:bg-tint hover:text-tint-foreground",
      // selected — the filled primary-action weight
      "data-[state=on]:border-primary-action data-[state=on]:bg-primary-action data-[state=on]:text-primary-foreground",
      className,
    )}
    {...props}
  />
));
FilterChip.displayName = "FilterChip";

export { FilterChip };
