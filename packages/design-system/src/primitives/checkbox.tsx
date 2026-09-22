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
 *   • invalid   `destructive-text` border while the control carries
 *               `aria-invalid` — the canvas reports an unmet statement on the
 *               BOX as well as in the message (auth canvas 497);
 *   • focus     the flush 3px `shadow-focus` ring rides the box
 *               (`peer-focus-visible`), so keyboard focus is visible.
 * The box never shrinks (`shrink-0`): it is a flex CHILD of the label, so a
 * label long enough to wrap used to squeeze the square into a rectangle — the
 * consent rows of the registration door wrap by design.
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

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional visible label rendered next to the box (wrapped by the same label). */
  children?: React.ReactNode;
  /** Semantic label tone for the surface that owns the checkbox. */
  tone?: "default" | "on-primary";
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, children, disabled, tone = "default", ...props }, ref) => {
    // The owner's canvas (`design-source/auth.dc.html:497`) turns the BOX red
    // while an unmet statement is being reported, so invalidity is carried by
    // the control itself and not by the message alone. The fact already travels
    // ON the control: `<FormControl>` publishes `aria-invalid`, so the primitive
    // reads that rather than asking every call site for a second flag which
    // could disagree with the one assistive technology is told.
    const invalid =
      props["aria-invalid"] === true || props["aria-invalid"] === "true";
    return (
    <label
      className={cn(
        // 12px between the box and the statement — the gap the canvas draws on
        // every checkbox row it has (186-224).
        "inline-flex items-center gap-3",
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
          "grid size-5.5 shrink-0 place-items-center border-2 bg-card text-primary-foreground transition-colors",
          "[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100",
          "peer-checked:bg-primary-action",
          // Reported-unmet wins over every resting border, checked included:
          // the canvas keeps the red frame on until the statement is granted.
          invalid
            ? "border-destructive-text"
            : "border-border peer-checked:border-primary-action",
          "peer-focus-visible:shadow-focus",
          "peer-disabled:border-hairline peer-disabled:bg-muted",
        )}
      >
        <CheckGlyph />
      </span>
      {children ? (
        <span
          className={cn(
            // Canvas 191/199/221 — the statement reads 13.5px/700 in ink on a
            // 1.4 line, one weight for EVERY consent row: an opt-in that reads
            // quieter than a condition is the platform grading its own asks.
            "text-chip font-bold leading-label",
            tone === "on-primary"
              ? "text-primary-surface-foreground peer-disabled:text-primary-surface-foreground"
              : "text-foreground peer-disabled:text-muted-2",
          )}
        >
          {children}
        </span>
      ) : null}
    </label>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
