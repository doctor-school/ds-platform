import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist checkbox (#513, source §07 "Чекбокс"). A REAL native checkbox —
 * the visually-hidden `<input type="checkbox">` is the keyboard + focus target, so
 * space toggles it and the label association is native (wrap children, or pass
 * `aria-label` for a bare control). The 22×22 visual box is a `peer` sibling driven
 * by the input's state:
 *   • off       2px `border`, `card` fill;
 *   • on        `primary-action` border + fill, the ✓ glyph revealed in
 *               `primary-foreground` (ink) — 14px, weight-800 read;
 *   • disabled  `hairline` border, `muted` fill;
 *   • focus     the flush 3px `shadow-focus` ring rides the box
 *               (`peer-focus-visible`), so keyboard focus is visible.
 * Square (radius 0). Token-only → light + `.dark` flip automatically.
 */
function CheckGlyph() {
  // A sharp, square-capped check — sized 14px, coloured by the box (`currentColor`
  // = `primary-foreground`). Revealed on check via the box's child-targeting
  // `peer-checked:[&>svg]:opacity-100` (hidden `[&>svg]:opacity-0` otherwise), so a
  // ghost check never lingers on an unchecked box in either theme.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="size-3.5"
    >
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional visible label rendered next to the box (wrapped by the same label). */
  children?: React.ReactNode;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
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
        className="peer sr-only"
        disabled={disabled}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5.5 place-items-center border-2 border-border bg-card text-primary-foreground transition-colors",
          "[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100",
          "peer-checked:border-primary-action peer-checked:bg-primary-action",
          "peer-focus-visible:shadow-focus",
          "peer-disabled:border-hairline peer-disabled:bg-muted",
        )}
      >
        <CheckGlyph />
      </span>
      {children ? (
        <span className="text-sm text-foreground peer-disabled:text-muted-2">
          {children}
        </span>
      ) : null}
    </label>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
