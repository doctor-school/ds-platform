import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist filter chip (#513, re-skin SoT `design-source/design-system.dc.html`
 * §05 "Чипы фильтра" + §06 "Чип фильтра"). A real toggle button (not a passive
 * span): the selection is carried on `aria-pressed`, so screen-reader users hear
 * the state and keyboard users toggle it natively.
 *
 * The visual language (source values): square (radius 0), a hard 2px border,
 * 13px = `text-caption`, padding `6px 13px` (`py-1.5 px-3.25`). States —
 *   • rest      transparent fill, pale `chip-border` outline, `tint-foreground`
 *               copy weight 700;
 *   • hover     fills with `tint`, the outline switches to `tint-foreground`;
 *   • selected  the accessible `primary-action` fill + `primary-foreground` copy
 *               weight 800, border in the same action colour; its own hover
 *               (`primary-hover`) and pressed (`primary-pressed`) steps of the
 *               action-fill triad (ADR-0013 §7 — every clickable declares the FULL
 *               state set; a selected chip is still a clickable control, and in
 *               `FilterBar` it is the REMOVE affordance, so a mouse operator with
 *               no hover feedback cannot tell it is actionable);
 *   • disabled  `hairline` outline, transparent fill, `muted-2` copy;
 *   • focus     the flush 3px `shadow-focus` ring (source global :focus-visible).
 * Token-only → light + `.dark` flip automatically.
 */
const filterChipVariants = cva(
  cn(
    "inline-flex items-center justify-center border-2 px-3.25 py-1.5 text-caption transition-all",
    // The pressed step is the neo-brutalist press translate the raised `Button`
    // uses (`primary-hover` and `primary-pressed` resolve to the same fill, so a
    // colour-only press would be invisible on the selected chip).
    "active:translate-x-0.5 active:translate-y-0.5",
    "focus-visible:outline-none focus-visible:shadow-focus",
    "disabled:pointer-events-none disabled:border-hairline disabled:bg-transparent disabled:text-muted-2 disabled:font-bold",
  ),
  {
    variants: {
      selected: {
        true: cn(
          "border-primary-action bg-primary-action text-primary-foreground font-extrabold",
          "hover:bg-primary-hover hover:border-primary-hover",
        ),
        false: cn(
          "border-chip-border bg-transparent text-tint-foreground font-bold",
          "hover:bg-tint hover:border-tint-foreground",
          "active:border-primary-action",
        ),
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface FilterChipProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">,
    VariantProps<typeof filterChipVariants> {
  /** Whether the chip is currently selected (reflected on `aria-pressed`). */
  selected?: boolean;
}

const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ className, selected = false, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      data-state={selected ? "selected" : "unselected"}
      className={cn(filterChipVariants({ selected }), className)}
      {...props}
    />
  ),
);
FilterChip.displayName = "FilterChip";

export { FilterChip, filterChipVariants };
