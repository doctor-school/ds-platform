import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist button (#512, re-skin from `design-source/design-system.dc.html`).
 *
 * The visual language: square corners (radius 0), a hard 2px structural border,
 * and a HARD OFFSET shadow (blur 0). On hover the control translates (2px,2px)
 * INTO its own cast as the shadow shrinks 4px→2px; on press it translates
 * (4px,4px) and the shadow collapses to 0 (`shadow-none`); focus adds the 3px
 * ring alongside the offset. Every colour flows through a token so both light and
 * `.dark` are correct automatically.
 *
 * FIDELITY TRAP (brief): the offset-shadow COLOUR differs per variant — a FILLED
 * action (`default`/`destructive`) casts in the INK/structural border tone
 * (`shadow-btn`, source `4px 4px 0 {border}`), a BORDERED surface
 * (`outline`/`secondary`) casts in the SOFT elevation tone (`shadow-ghost`,
 * source `4px 4px 0 {shadowSm}`). They are NOT the same token.
 */

// The raised-button motion + collapse shared by every offset-shadow variant:
// hover slides into the cast, press flattens it, disabled removes it (opacity .4,
// no shadow, source lines 219/231). The per-variant classes own the shadow COLOUR.
const RAISED_MOTION =
  "hover:translate-x-0.5 hover:translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-none disabled:opacity-40";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm transition-all focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary — filled blue.700 action, white copy weight 800, INK offset cast.
        default: cn(
          "border-2 border-primary-action bg-primary-action text-primary-foreground font-extrabold shadow-btn",
          "hover:bg-primary-hover hover:border-primary-hover hover:shadow-btn-hover focus-visible:shadow-btn-focus",
          RAISED_MOTION,
        ),
        // Destructive — filled danger red, same ink offset cast as primary.
        destructive: cn(
          "border-2 border-destructive bg-destructive text-destructive-foreground font-extrabold shadow-btn",
          "hover:shadow-btn-hover focus-visible:shadow-btn-focus",
          RAISED_MOTION,
        ),
        // Outline — the source "Ghost": bordered surface, weight 700, SOFT offset
        // cast; hover fills with `tint` and switches the border to the brand accent.
        outline: cn(
          "border-2 border-border bg-background text-foreground font-bold shadow-ghost",
          "hover:bg-tint hover:border-primary hover:shadow-ghost-hover focus-visible:shadow-ghost-focus",
          "disabled:border-hairline disabled:text-muted-2",
          RAISED_MOTION,
        ),
        // Secondary — a bordered tonal fill; reads as an enabled raised control
        // (#227/#267), same soft offset cast as `outline`.
        secondary: cn(
          "border-2 border-border bg-secondary text-secondary-foreground font-bold shadow-ghost",
          "hover:bg-tint hover:border-primary hover:shadow-ghost-hover focus-visible:shadow-ghost-focus",
          RAISED_MOTION,
        ),
        // Ghost — minimal, no border/offset; a quiet tint fill on hover, ring on focus.
        ghost:
          "font-bold text-foreground hover:bg-tint hover:text-tint-foreground focus-visible:shadow-focus disabled:opacity-40",
        // Link — text action; underline on hover, ring on focus.
        link: "font-bold text-primary-action underline-offset-4 hover:underline focus-visible:shadow-focus active:text-primary-action/80 disabled:opacity-40",
      },
      size: {
        default: "px-5 py-3",
        sm: "px-4 py-2 text-caption",
        lg: "px-8 py-4",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Determinate loading spinner shown while `loading` is set. `currentColor`
 * inherits the button's text colour so it works on every variant; `animate-spin`
 * is a core utility and is neutralised under `prefers-reduced-motion` by the L1
 * base-reset. `aria-hidden` keeps it out of the a11y tree — the busy state is
 * announced via the button's `aria-busy`.
 */
function ButtonSpinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Busy state: renders a spinner, sets `aria-busy`, and blocks interaction
   * (the button is disabled while loading). Ignored for `asChild` buttons, whose
   * single-child Slot contract leaves the busy presentation to the call site;
   * `aria-busy` is still forwarded so assistive tech is informed.
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const showSpinner = loading && !asChild;
    // When asChild, `showSpinner` is false so `content` stays the single child the
    // Slot contract requires; only a real <button> ever gets the spinner sibling.
    const content = showSpinner ? (
      <>
        <ButtonSpinner />
        {children}
      </>
    ) : (
      children
    );
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || showSpinner}
        aria-busy={loading || undefined}
        {...props}
      >
        {content}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
