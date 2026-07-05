import * as React from "react";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          interactiveBase,
          // Neo-brutalist field (#512): a hard 2px-bordered, square slab. Focus
          // paints the blue.300 `border-ring` (#6BB1F7) on top of the shared
          // `interactiveBase` ring; a `data-[success]` hook lets a validated field
          // read green (token-driven, set by the surface when a value is valid).
          "flex h-9 w-full rounded-none border-2 border-input bg-background px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed data-[success]:border-success",
          // K-3 (#333): invalidity is carried by the field itself — a destructive
          // border, a faint danger tint, and a destructive focus ring (overriding
          // interactiveBase's `ring-ring`). `FormControl` sets `aria-invalid` on the
          // errored input, so the error reads on the control, not just the message.
          "aria-invalid:border-destructive aria-invalid:bg-destructive/10 aria-invalid:focus-visible:ring-destructive",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
