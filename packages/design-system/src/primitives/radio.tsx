import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist radio (#513, source §07 "Радио"). A REAL native radio — the
 * visually-hidden `<input type="radio">` owns keyboard roving + single-select
 * within its `name` group. The 22×22 visual is the ONLY rounded element in the
 * whole language (`rounded-full`, source note "border-radius:50%"):
 *   • off       2px `border`, `card` fill;
 *   • on        border switches to `primary-action`, the fill stays `card`, and a
 *               10px inner `primary-action` dot is revealed;
 *   • disabled  `hairline` border, `muted` fill;
 *   • focus     the flush 3px `shadow-focus` ring rides the box.
 * Token-only → light + `.dark` flip automatically.
 */
export interface RadioProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional visible label rendered next to the control (wrapped by the same label). */
  children?: React.ReactNode;
}

const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  ({ className, children, disabled, ...props }, ref) => (
    <label
      className={cn(
        "inline-flex items-center gap-2",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <input
        ref={ref}
        type="radio"
        className="peer sr-only"
        disabled={disabled}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5.5 place-items-center rounded-full border-2 border-border bg-card transition-colors",
          "[&>span]:opacity-0 peer-checked:[&>span]:opacity-100",
          "peer-checked:border-primary-action",
          "peer-focus-visible:shadow-focus",
          "peer-disabled:border-hairline peer-disabled:bg-muted",
        )}
      >
        <span className="size-2.5 rounded-full bg-primary-action" />
      </span>
      {children ? (
        <span className="text-sm text-foreground peer-disabled:text-muted-2">
          {children}
        </span>
      ) : null}
    </label>
  ),
);
Radio.displayName = "Radio";

export { Radio };
