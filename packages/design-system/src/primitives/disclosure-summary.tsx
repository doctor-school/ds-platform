import * as React from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";

/**
 * `DisclosureSummary` — the `<summary>` of a native `<details>` disclosure,
 * rendered as the canvas on-header chip (#2180, `design-source/ds-shell.dc.html`
 * line 43: the `≡` control beside the theme toggle is the SAME 44px white chip
 * as the guest/profile control, at the glyph type size).
 *
 * Why a primitive and not a hand-assembled tag at the call site: a raw
 * `<summary>` carrying `buttonVariants(...)` plus its own `cursor`, marker-reset
 * and glyph size IS a design-system control assembled outside the design system —
 * exactly the fork `local/no-primitive-style-override` exists to stop (ADR-0013
 * §6). The three pieces the tag needs beyond the chip — the pointer cursor, the
 * suppressed native disclosure marker (`list-none` plus the WebKit
 * pseudo-element) and the larger glyph step — belong to the control, so they live
 * here and both storefronts get the same disclosure by construction.
 *
 * The element stays a native `<summary>`: `<details>`/`<summary>` already own the
 * open/close semantics, keyboard activation and the `aria-expanded` mapping, so
 * no JS state and no ARIA of our own is needed.
 */
const DisclosureSummary = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"summary">
>(({ className, ...props }, ref) => (
  <summary
    ref={ref as React.Ref<HTMLElement>}
    className={cn(
      buttonVariants({ variant: "on-primary", size: "icon" }),
      "cursor-pointer list-none text-xl [&::-webkit-details-marker]:hidden",
      className,
    )}
    {...props}
  />
));
DisclosureSummary.displayName = "DisclosureSummary";

export { DisclosureSummary };
