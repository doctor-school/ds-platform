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
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed",
          // K-3 (#333): invalidity is carried by the field itself — a destructive
          // border + a destructive focus ring (overriding interactiveBase's
          // `ring-ring`). `FormControl` sets `aria-invalid` on the errored input,
          // so the error reads on the control, not just the message text.
          "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
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
