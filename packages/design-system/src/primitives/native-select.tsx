import * as React from "react";

import { cn } from "../lib/utils";

/** True when a native select has moved beyond its empty placeholder option. */
function hasValue(value: unknown): boolean {
  return value != null && value !== "";
}

export type NativeSelectProps = React.ComponentPropsWithoutRef<"select">;

/**
 * Official shadcn/ui NativeSelect composition, owned and re-skinned to DS tokens.
 *
 * The browser keeps the actual `<select>` so keyboard navigation, type-ahead,
 * form submission, and mobile pickers remain platform-native. The wrapper only
 * positions a quiet, pointer-inert chevron; the control mirrors `Input` geometry
 * and its filled / focus-visible / invalid / disabled state language.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, value, defaultValue, onChange, children, ...props }, ref) => {
    const isControlled = value !== undefined;
    const [uncontrolledFilled, setUncontrolledFilled] = React.useState(() =>
      hasValue(defaultValue),
    );
    const filled = isControlled ? hasValue(value) : uncontrolledFilled;

    return (
      <span className="relative block w-full">
        <select
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          data-filled={filled ? "true" : undefined}
          onChange={(event) => {
            if (!isControlled) {
              setUncontrolledFilled(hasValue(event.target.value));
            }
            onChange?.(event);
          }}
          className={cn(
            "flex h-11 w-full appearance-none border-2 bg-background px-3.5 py-3 pr-10 text-sm transition-colors",
            filled
              ? "border-border text-foreground"
              : "border-hairline text-muted-foreground",
            "focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-muted disabled:text-muted-foreground",
            "aria-invalid:border-destructive aria-invalid:bg-destructive-tint",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    );
  },
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
