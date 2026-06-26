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
      // K-2 (#333): `gap-2` opens a visible track between segments so an inactive
      // segment's hover fill never butts flush against the active segment — the
      // slice-B defect was hover-gluing (two segments reading as one block on
      // hover), which a transparent border alone did not fix.
      "inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-muted p-1 text-muted-foreground",
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
      // transition-all (not just colors) so the active shadow animates too.
      // #4 tab inset (ADR-0013 §7): every trigger carries a persistent
      // `border border-transparent` so the active state's `bg-background` +
      // `shadow` never shifts its inactive neighbour — the inactive hover reads
      // as an inset chip inside the `px-3 py-1` padding, not a flush block.
      // Inactive resting is the muted `text-foreground/60` → `hover:text-foreground`.
      "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-md border border-transparent px-3 py-1 text-sm font-medium transition-all disabled:pointer-events-none data-[state=inactive]:text-foreground/60 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow data-[state=inactive]:hover:bg-background/50 data-[state=inactive]:hover:text-foreground",
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
