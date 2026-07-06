import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist text input (#512, re-skin from `design-source/design-system.dc.html`,
 * §07 field states). Square, a hard 2px border: `hairline` at rest → the brand
 * `ring` (blue.300) on focus with the flush 3px focus ring (`shadow-focus`, no
 * offset gap — the source's `border-color:#6BB1F7; box-shadow:0 0 0 3px …`).
 * Invalidity is carried on the control itself (K-3, #333): a destructive border +
 * the pale `destructive-tint` fill (source `dangerTint`), set by `FormControl`'s
 * `aria-invalid`. Disabled dims to the muted track. Token-only → light + `.dark`.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full border-2 border-hairline bg-background px-3.5 py-3 text-sm text-foreground transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground",
          "aria-invalid:border-destructive aria-invalid:bg-destructive-tint",
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
