"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

/**
 * Switch — an instant on/off toggle (#513), built on `@radix-ui/react-switch`.
 * Radix owns the `role="switch"` / `aria-checked` / keyboard-toggle contract.
 * Unlike a Checkbox (a form opt-in you submit), a Switch takes effect
 * immediately (a setting).
 *
 * States (issue #513):
 *   - off: a hard 2px `border` track on the `muted` surface, thumb at the start.
 *   - on (`data-state=checked`): the `primary-action` track fill, thumb slid to
 *     the end.
 *
 * Neo-brutalist: a 0-radius track with a hard-edged square thumb (`background`
 * fill, hard border). Token-only; composes `interactiveBase` for the focus ring.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      interactiveBase,
      "peer inline-flex h-6 w-11 shrink-0 items-center rounded-none border-2 border-input p-0.5",
      "disabled:cursor-not-allowed",
      "data-[state=unchecked]:bg-muted data-[state=checked]:bg-primary-action data-[state=checked]:border-primary-action",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-4 rounded-none bg-background shadow-sm ring-0 transition-transform",
        "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-5",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
