import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import { HEADER_CHIP_SURFACE } from "./header-chip";

/**
 * Neo-brutalist button (#512, re-skin from `design-source/ds-foundation.dc.html`).
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
 * (`shadow-btn`, source `4px 4px 0 {border}`), the white `on-primary` header
 * chip uses the theme-invariant white-chip cast (`shadow-header-chip`), and a
 * BORDERED surface (`outline`/`secondary`) casts in the SOFT elevation tone
 * (`shadow-ghost`, source `4px 4px 0 {shadowSm}`). They are NOT the same token.
 */

// The raised-button motion + collapse shared by every offset-shadow variant:
// hover slides into the cast, press flattens it, disabled removes it (opacity .4,
// no shadow, source lines 219/231). The per-variant classes own the shadow COLOUR.
// `on-primary` is the exception — the header chip carries the canvas's own 1px
// slide, declared on the variant.
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
        // On primary — THE header chip: the canvas white control on the
        // invariant navy band (`ds-shell.dc.html` line 37 — `background:#fff`,
        // navy `#114D9E` ink, NO border, a 3px offset cast that shrinks as the
        // control slides 1px into it). It is the single definition BOTH
        // storefronts and the webinar room compose from — the guest chip, the
        // profile chip and the mobile `≡` are this variant at a different size,
        // never a second class-string constant (#2180).
        //
        // The surface is {@link HEADER_CHIP_SURFACE}, declared once: its
        // `shadow-header-chip` cast is the theme-INVARIANT dark ink offset, NOT
        // the generic `shadow-btn`, whose `border` cast flips to WHITE in dark
        // and rendered the chip a white square with a white shadow on the navy
        // band (#1145).
        //
        // Its press chain is the chip's own, not {@link RAISED_MOTION}: the
        // canvas slides the chip 1px (not 2) and the ink is PINNED full-strength
        // on press, because the primitive's press tint goes near-white on a
        // white chip in dark.
        "on-primary": cn(
          "flex-none font-extrabold",
          HEADER_CHIP_SURFACE,
          "hover:no-underline hover:translate-x-px hover:translate-y-px hover:shadow-header-chip-hover",
          "active:translate-x-0.5 active:translate-y-0.5 active:shadow-none active:text-header-chip-foreground",
          "focus-visible:shadow-focus",
          "disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-none disabled:opacity-40",
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
        // The on-header chip geometry of the canvas (`ds-shell.dc.html` line
        // 37): 12×22 padding at 13.5px/800. Both halves are tokens
        // (`space.3` / `space.chip-x` / `font.size.chip`), so the chip's size
        // changes in ONE place for both storefronts. `leading-5` pins the line
        // box so the chip's height is the same 44px as the theme toggle and the
        // `≡` beside it instead of following the font's `normal` metrics.
        chip: "px-chip-x py-3 text-chip leading-5",
        // The 40px initials/profile square (§05 avatar geometry) as a chip size,
        // so the profile chip is this one variant rather than a parallel
        // class-string constant.
        avatar: "size-10 text-sm",
      },
      // The SURFACE the control sits on, declared LAST so it wins the ink over
      // the variant's own resting colour. `header` is the invariant navy band of
      // `design-source/ds-shell.dc.html` line 36 (`color:#fff` on a transparent
      // control): a quiet chrome control — the theme toggle — reads in the band's
      // own foreground instead of the page ink, without the call site re-colouring
      // the primitive (#2180, ADR-0013 §6).
      tone: {
        default: "",
        header: "text-header-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      tone: "default",
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
      tone,
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
        className={cn(buttonVariants({ variant, size, tone, className }))}
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
