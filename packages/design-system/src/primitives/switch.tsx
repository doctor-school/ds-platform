import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist switch / toggle (#513, source §07 "Тумблер"). A REAL native
 * checkbox exposed as `role="switch"` — the visually-hidden input is the keyboard
 * (space) + focus target; `role="switch"` maps its checked state to on/off for
 * assistive tech. The 46×26 SQUARE track (radius 0) is a `peer` sibling; a 16×16
 * knob rides inside it:
 *   • off   `hairline` track, 2px `border`, `card` knob with a 2px border, LEFT;
 *   • on     `primary-action` track + border, `primary-foreground` knob (no visible
 *            border), pushed RIGHT (`justify-end`);
 *   • focus  the flush 3px `shadow-focus` ring rides the track.
 * The knob's on-state is driven from the track via a child-targeting
 * `peer-checked:[&>span]:…` (the knob is not itself the input's sibling). Padding
 * `0 2px` (`px-0.5`), `box-border`. Token-only → light + `.dark` flip.
 */
export interface SwitchProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional visible label rendered next to the track (wrapped by the same label). */
  children?: React.ReactNode;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
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
        type="checkbox"
        role="switch"
        className="peer sr-only"
        disabled={disabled}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "box-border inline-flex h-6.5 w-11.5 items-center justify-start border-2 border-border bg-hairline px-0.5 transition-colors",
          "peer-checked:justify-end peer-checked:border-primary-action peer-checked:bg-primary-action",
          "peer-checked:[&>span]:border-transparent peer-checked:[&>span]:bg-primary-foreground",
          "peer-focus-visible:shadow-focus",
          "peer-disabled:opacity-40",
        )}
      >
        <span className="size-4 box-border border-2 border-border bg-card transition-colors" />
      </span>
      {children ? (
        <span className="text-sm text-foreground peer-disabled:text-muted-2">
          {children}
        </span>
      ) : null}
    </label>
  ),
);
Switch.displayName = "Switch";

export { Switch };
