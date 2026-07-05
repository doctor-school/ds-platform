"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

/**
 * RadioGroup / RadioGroupItem — single-choice control (#513), built on
 * `@radix-ui/react-radio-group`. Radix owns the `role="radiogroup"` / `radio`
 * wiring, roving tabindex, and arrow-key selection.
 *
 * States (issue #513):
 *   - off: a hard 2px `border` box.
 *   - on (`data-state=checked`): a filled `primary-action` inner square
 *     indicator inside the same hard frame.
 *
 * Neo-brutalist 0-radius square (the same hard-edge language as Checkbox — the
 * ROLE and the filled-square vs ✓ glyph distinguish radio from checkbox, not a
 * rounded silhouette). Token-only; composes `interactiveBase` for the focus ring.
 */
const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    ref={ref}
    className={cn("grid gap-2", className)}
    {...props}
  />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      interactiveBase,
      "size-5 shrink-0 rounded-none border-2 border-input bg-background",
      "disabled:cursor-not-allowed",
      "hover:border-primary-action",
      "data-[state=checked]:border-primary-action",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      {/* filled inner square — the selected indicator (decorative; the checked
          state is announced by Radix's aria-checked). */}
      <span aria-hidden="true" className="block size-2.5 bg-primary-action" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
