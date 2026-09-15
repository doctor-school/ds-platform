import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * `Link` primitive (#324) — the `link` row of the per-clickable interaction-state
 * matrix (ADR-0013 §7), implemented as an owned component so portal nav/footer
 * links stop being raw `<Link className="underline">` anchors with no hover, focus,
 * or disabled treatment (defect #3).
 *
 * Composes the shared `interactiveBase` (the `focus-visible` ring identical to the
 * hover affordance — WAI consistency) with the `link` states: `text-primary-action`
 * (blue.700 `#114D9E`, the brand-anchored accessible link colour — 8.14:1 on white,
 * WCAG AA for normal-weight text, where `primary`/blue.500 is only ~3.3:1 and fails
 * the axe scan), `hover:underline` (`underline-offset-4`), `active:text-primary-action/80`,
 * and the `disabled:opacity-50` dim. Cursor + `prefers-reduced-motion` come from the L1
 * `globals.css` base-reset; an `aria-disabled` link also gets `pointer-events-none`
 * so it is inert like a disabled control. Token-only throughout (no arbitrary
 * Tailwind values — the §5 / #269 guard must stay green).
 *
 * On the invariant brand surface, `tone="on-primary"` switches the resting
 * colour to full-strength `primary-surface-foreground` and the active delta to
 * AA-safe `primary-surface-muted`; hover underline and focus ring stay intact.
 *
 * Four `variant` shapes:
 *  - `standalone` (default) — a nav/footer link: NO resting underline, relies on
 *    brand colour + hover-underline + focus ring (NN/g + WCAG: a standalone link
 *    may drop the resting underline when colour + hover + focus distinguish it);
 *  - `inline` — a link inside body copy: a resting underline so it reads as a link
 *    against surrounding text (the WCAG "don't rely on colour alone" default);
 *  - `wrapper` — the link wraps non-text content (the storefront wordmark), so the
 *    hover underline has nothing to decorate and is suppressed;
 *  - `mobile-nav-row` — one full-bleed row of the mobile nav sheet.
 *
 * `tone` carries the ink (`default`, `on-primary`, `header-nav` for the navy
 * band's muted nav tier, `neutral` for page ink), `size` the type step
 * (`default`, `sm` = the canvas 13.5px nav/footer link) and `weight` the stroke
 * (`default` = 700, `strong` = the canvas 800 cross-storefront link). Every one
 * of them is backed by `design-source/ds-shell.dc.html`; the storefront chrome
 * composes them instead of re-styling this primitive at the call site (#2180).
 *
 * `asChild` (Radix `Slot`, same contract as `Button`) lets it wrap `next/link`:
 * `<Link asChild><NextLink href="…">…</NextLink></Link>` so routing stays with
 * Next while the interaction states come from this primitive.
 */
const linkVariants = cva(
  // Neo-brutalist link (#512): brand-anchored `primary-action` colour, hover
  // underline, and the flush 3px `shadow-focus` keyboard ring (the source's
  // global `:focus-visible` 3px blue outline) — consistent with every other
  // re-skinned control, instead of the generic ring-with-offset. Token-only.
  "underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:shadow-focus aria-disabled:pointer-events-none aria-disabled:opacity-50",
  {
    // Axis ORDER is the cascade: `tone` (the ink) emits first, then `variant`
    // (the shape), then `size`, then `weight` — so a shape that carries its own
    // ink wins over the tone, and the call site never has to re-order classes.
    variants: {
      tone: {
        default: "text-primary-action active:text-primary-action/80",
        "on-primary":
          "text-primary-surface-foreground active:text-primary-surface-muted",
        // The invariant navy header band (`design-source/ds-shell.dc.html`
        // line 28): the muted on-navy tier `#D3E8FD` with no resting underline,
        // and the press step one VISIBLE step below the resting tier via ELEMENT
        // opacity (#270) — the DS press tint cannot be used here because
        // `primary-action` IS the band colour and painted the label invisible
        // (#1007).
        "header-nav":
          "text-header-foreground no-underline opacity-80 active:text-header-foreground active:opacity-60",
        // Page ink: a link that reads as a ROW of a surface (the mobile nav
        // sheet, canvas line 46) rather than as an inline action.
        neutral: "text-foreground",
      },
      variant: {
        standalone: "",
        inline: "underline",
        // A link that WRAPS non-text content (the wordmark, canvas line 19):
        // there is no text to underline, so the hover affordance is suppressed.
        wrapper: "hover:no-underline",
        // One row of the mobile nav sheet (canvas line 46): a full-bleed target
        // with the surface tint on hover instead of an underline.
        "mobile-nav-row": "px-4 py-3 hover:bg-muted hover:no-underline",
      },
      size: {
        default: "",
        // The canvas nav/footer link type size, 13.5px (`ds-shell.dc.html`
        // lines 85/95) — the `sm` step of the scale.
        sm: "text-sm",
      },
      weight: {
        default: "font-bold",
        // The canvas cross-storefront link, weight 800 (`ds-shell.dc.html`
        // line 99).
        strong: "font-extrabold",
      },
    },
    defaultVariants: {
      variant: "standalone",
      tone: "default",
      size: "default",
      weight: "default",
    },
  },
);

export interface LinkProps
  extends
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof linkVariants> {
  asChild?: boolean;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  (
    { className, variant, tone, size, weight, asChild = false, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "a";
    return (
      <Comp
        className={cn(linkVariants({ variant, tone, size, weight, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Link.displayName = "Link";

export { Link, linkVariants };
