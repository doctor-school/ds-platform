import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist initials avatar (#513, source §05 "Аватар · инициалы"). A 40×40
 * SQUARE (radius 0 — the language has no rounded avatar), centred initials
 * 14px/800 (`text-sm font-extrabold`). Two tonal fills:
 *   • `default`  the accessible `primary-action` fill + `primary-foreground`;
 *   • `tint`     the pale `tint` fill + `tint-foreground`.
 * Token-only, both themes. Purely presentational — pass an `aria-label` (or wrap
 * with visible text) if the initials must be announced.
 */
const avatarVariants = cva(
  "inline-flex size-10 select-none items-center justify-center text-sm font-extrabold",
  {
    variants: {
      variant: {
        default: "bg-primary-action text-primary-foreground",
        tint: "bg-tint text-tint-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface AvatarProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(avatarVariants({ variant }), className)}
      {...props}
    />
  ),
);
Avatar.displayName = "Avatar";

export { Avatar, avatarVariants };
