"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../lib/utils";
import { interactiveBase } from "./interactive-base";

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
      // Neo-brutalist segment control (#512): one hard 2px-bordered, square track
      // holding flush segments (no gap, no inner padding) — the segments share the
      // track's frame and are divided by a 2px rule, so the whole control reads as
      // a single ink-framed block, not floating chips.
      //
      // NOT `overflow-hidden`: the square (radius-0) track needs no corner clip, and
      // a clip would cut a keyboard-focused trigger's `focus-visible` ring (which
      // `focus-visible:z-10` cannot escape). The segments already sit inside the
      // border box, so the flush look holds without clipping.
      "inline-flex h-9 w-full items-center justify-center rounded-none border-2 border-border bg-background text-muted-foreground",
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
      interactiveBase,
      // Each segment is a flush, square, bold cell divided from its neighbour by a
      // 2px right rule (`last:border-r-0` drops the trailing one). The ACTIVE
      // segment fills solid with the primary action colour (white on blue.700, AA);
      // inactive resting is the AA-safe quiet tier `text-muted-foreground` (full
      // strength, #270) with an `accent` hover fill. `focus-visible:z-10` lifts the
      // focused segment's ring above its neighbours' borders.
      "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-none border-r-2 border-border px-3 py-1 text-sm font-bold transition-colors last:border-r-0 focus-visible:z-10 disabled:pointer-events-none data-[state=inactive]:text-muted-foreground data-[state=active]:bg-primary-action data-[state=active]:text-primary-foreground data-[state=inactive]:hover:bg-accent data-[state=inactive]:hover:text-foreground",
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
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
