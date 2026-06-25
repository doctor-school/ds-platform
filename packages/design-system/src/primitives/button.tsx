import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

const buttonVariants = cva(
  cn(
    interactiveBase,
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default:
          "bg-primary-action text-primary-foreground shadow hover:bg-primary-hover active:bg-primary-pressed",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        // A bordered tonal secondary (#227/#267 owner finding): the borderless
        // light fill read as "disabled" against the card. A resting border gives
        // it the same clickable weight as `outline`, the tonal fill keeps it
        // distinct, and the brand-ring hover + darker active make the interaction
        // unmistakable. Token-only (`border-input` / `secondary` / `ring`).
        secondary:
          "border border-input bg-secondary text-secondary-foreground shadow-sm hover:border-ring hover:bg-secondary/70 active:bg-secondary/60",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        link: "text-primary underline-offset-4 hover:underline active:text-primary/80",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
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
