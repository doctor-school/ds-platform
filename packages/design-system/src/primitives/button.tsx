import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

/**
 * Neo-brutalist button (#512, canvas 8cc2f39a). Every variant is a hard
 * 2px-bordered, square (`--button-radius` 0) slab with bold text. The filled
 * variants cast the token offset shadow (`shadow-md` = `4px 4px 0`) and "press
 * into the page" on interaction: hover nudges the slab +2px toward the shadow and
 * shrinks it to 2px (`shadow-base`), pressed nudges +4px and drops the shadow to
 * 0. Focus adds the shared `interactiveBase` ring on top of the offset shadow
 * (they compose as separate box-shadow layers); disabled loses the shadow and
 * dims via the shared `interactiveBase` dim (the `opacity-50` token — see the PR
 * decision-debt note re: the issue's `.4`, which has no token). `link` opts out of
 * the frame — it is a bare text link. Token-only (`border-input` / `shadow-md` /
 * `shadow-base` / the spacing scale for the translate).
 */
const buttonVariants = cva(
  cn(
    interactiveBase,
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none border-2 border-input text-sm font-bold transition-all disabled:pointer-events-none disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default:
          "bg-primary-action text-primary-foreground shadow-md hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-primary-hover hover:shadow-base active:translate-x-1 active:translate-y-1 active:bg-primary-pressed active:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground shadow-md hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-destructive/90 hover:shadow-base active:translate-x-1 active:translate-y-1 active:bg-destructive/80 active:shadow-none",
        outline:
          "bg-background text-foreground shadow-md hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-accent hover:text-accent-foreground hover:shadow-base active:translate-x-1 active:translate-y-1 active:bg-accent/80 active:shadow-none",
        secondary:
          "bg-secondary text-secondary-foreground shadow-md hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-secondary/70 hover:shadow-base active:translate-x-1 active:translate-y-1 active:bg-secondary/60 active:shadow-none",
        // Ghost keeps the offset-shadow treatment (issue: "primary / ghost") but a
        // transparent fill so the page reads through — the low-emphasis slab.
        ghost:
          "bg-transparent text-foreground shadow-md hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-accent hover:text-accent-foreground hover:shadow-base active:translate-x-1 active:translate-y-1 active:bg-accent/80 active:shadow-none",
        // `link` is a bare text link — no frame, no offset shadow, no press-motion.
        link: "border-transparent bg-transparent text-primary-action shadow-none underline-offset-4 hover:underline active:text-primary-action/80",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
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
