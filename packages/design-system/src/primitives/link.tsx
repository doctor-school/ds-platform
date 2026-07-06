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
 * Two variants:
 *  - `standalone` (default) — a nav/footer link: NO resting underline, relies on
 *    brand colour + hover-underline + focus ring (NN/g + WCAG: a standalone link
 *    may drop the resting underline when colour + hover + focus distinguish it);
 *  - `inline` — a link inside body copy: a resting underline so it reads as a link
 *    against surrounding text (the WCAG "don't rely on colour alone" default).
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
  "text-primary-action underline-offset-4 transition-colors font-bold hover:underline active:text-primary-action/80 focus-visible:outline-none focus-visible:shadow-focus aria-disabled:pointer-events-none aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        standalone: "",
        inline: "underline",
      },
    },
    defaultVariants: {
      variant: "standalone",
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
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "a";
    return (
      <Comp
        className={cn(linkVariants({ variant, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Link.displayName = "Link";

export { Link, linkVariants };
