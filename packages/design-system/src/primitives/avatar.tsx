"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Avatar — an initials (or image) identity chip (#513), built on
 * `@radix-ui/react-avatar`, which owns the image-load → fallback swap. Speaker
 * lists in the webinars surfaces are initials-first, so the `AvatarFallback`
 * (rendered synchronously when there is no image) is the common path.
 *
 * Neo-brutalist (#511): a hard 2px border, 0 radius (a square identity plate,
 * not a circle), Inter medium initials. Two tonal variants:
 *   - `solid` — the `primary-action` fill (btn-bg) with white initials.
 *   - `tint`  — the pale `tint` surface with `tint-foreground` initials.
 *
 * Give the root an accessible name (`aria-label="Full Name"`) at the call site;
 * the initials are a visual shorthand.
 */
const avatarVariants = cva(
  "relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-none border-2 border-border text-sm font-medium",
  {
    variants: {
      variant: {
        solid: "bg-primary-action text-primary-foreground",
        tint: "bg-tint text-tint-foreground",
      },
    },
    defaultVariants: {
      variant: "solid",
    },
  },
);

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> &
    VariantProps<typeof avatarVariants>
>(({ className, variant, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(avatarVariants({ variant }), className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("size-full object-cover", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("inline-flex size-full items-center justify-center", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback, avatarVariants };
