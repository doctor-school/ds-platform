"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

/**
 * Checkbox — a binary opt-in control (#513), built on
 * `@radix-ui/react-checkbox`. Radix owns the `role="checkbox"` /
 * `aria-checked` / keyboard-toggle contract; register consent (#517) composes
 * this for the terms opt-in, so the a11y wiring is load-bearing.
 *
 * States (issue #513):
 *   - off: a hard 2px `border` box on the flat page.
 *   - on (`data-state=checked`): the `primary-action` fill (btn-bg) with a white
 *     ✓ glyph (inline SVG, `aria-hidden` — the checked state is announced by
 *     Radix's `aria-checked`, not the icon).
 *   - disabled: dimmed via the shared `interactiveBase` `disabled:opacity-50`.
 *
 * Neo-brutalist 0-radius square; token-only; composes `interactiveBase` for the
 * focus-visible ring.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      interactiveBase,
      "peer size-5 shrink-0 rounded-none border-2 border-input bg-background",
      "disabled:cursor-not-allowed",
      "data-[state=checked]:border-primary-action data-[state=checked]:bg-primary-action data-[state=checked]:text-primary-foreground",
      "hover:border-primary-action",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <svg
        className="size-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
        aria-hidden="true"
      >
        <path d="M3 8.5 6.5 12 13 4.5" />
      </svg>
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
