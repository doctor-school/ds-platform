"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../lib/utils";

/**
 * Segmented-control / tabs built on `@radix-ui/react-tabs`. Radix supplies the
 * full `tablist`/`tab`/`tabpanel` ARIA wiring and arrow-key roving focus for
 * free, and `TabsContent` only renders the ACTIVE panel — the inactive method's
 * fields are removed from the DOM (used by the #179 /login method switcher to
 * show one sign-in method at a time). Styled with the repo's Tailwind-4 tokens.
 */
const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Neo-brutalist segment control (#512, source §05 "Сегмент-контрол"): a
      // single hard 2px-bordered container, no rounding, no gap, no padding — the
      // segments butt together and are divided by a 2px rule (owned per-trigger
      // via `border-l-2`, dropped on the first). Full-width like the old list.
      "inline-flex w-full items-stretch border-2 border-border bg-background",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Neo-brutalist segment (source §05): selected = `primary-action` fill +
      // `primary-foreground` weight 800; unselected = surface + `tint-foreground`
      // weight 700. Divider = a 2px left border between segments (`first:border-l-0`
      // drops it on the leading segment). Focus = the flush 3px `shadow-focus` ring
      // (z-10 so it is not clipped by the container border). Font 13px = `text-caption`.
      "relative z-0 inline-flex flex-1 items-center justify-center whitespace-nowrap border-l-2 border-border first:border-l-0 px-4.5 py-3 text-caption transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40",
      "data-[state=active]:bg-primary-action data-[state=active]:text-primary-foreground data-[state=active]:font-extrabold",
      "data-[state=inactive]:bg-background data-[state=inactive]:text-tint-foreground data-[state=inactive]:font-bold data-[state=inactive]:hover:bg-tint",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:shadow-focus",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
