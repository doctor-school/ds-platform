"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "../lib/utils";

type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  /**
   * Marks the label's field as required (#529, source §07): appends the canvas's
   * destructive `*` marker (`Email *`). The asterisk is DECORATIVE — the machine
   * `required` semantics belong on the input, not the label — so it is `aria-hidden`
   * and never read out as noise. `required` is consumed here, never spread onto the
   * DOM `<label>` (which is not a form control).
   */
  required?: boolean;
};

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      // Neo-brutalist field label (#512, source §07): 12px extrabold-ish 700 ink.
      "text-xs font-bold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  >
    {children}
    {required ? (
      <span aria-hidden className="text-destructive-text">
        {" "}
        *
      </span>
    ) : null}
  </LabelPrimitive.Root>
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
