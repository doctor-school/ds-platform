"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { buttonVariants } from "./button";
import { cn } from "../lib/utils";

/**
 * Confirmation dialog, adopted from **official shadcn/ui `alert-dialog`** (MIT) on
 * its `@radix-ui/react-alert-dialog` substrate and re-skinned to the DS tokens
 * (#1339, Stage-A record on #1337).
 *
 * WHY A SECOND DIALOG PRIMITIVE RATHER THAN A PROP ON THE FIRST: the two differ in
 * DISMISSAL SEMANTICS, not in looks. `AlertDialog` interrupts to demand an answer —
 * Radix gives it `role="alertdialog"`, refuses outside-press dismissal, and moves
 * initial focus to the CANCEL action so a stray Enter never fires the consequential
 * one. Encoding that as `<Dialog dismissible={false}>` would leave the ARIA role and
 * the focus default as call-site details every surface has to remember; here they
 * are the primitive's own contract. That is exactly the guarantee feature 014 needs:
 * publish / unpublish / retire / restore each confirm before firing (014-design §7),
 * and #1338's «Отметить завершённым» reuses the same primitive.
 *
 * The action pair reuses the {@link ./button.tsx `Button`} variants rather than
 * re-declaring a bordered/filled look — one owner for the raised-button motion and
 * the focus ring. `AlertDialogAction` defaults to the primary variant; a destructive
 * confirmation passes `variant="destructive"` through, and a retire/unpublish keeps
 * the primary one because it is reversible.
 */
const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    // Theme-invariant scrim, same reason as `Dialog`: a `foreground`-keyed veil
    // would invert to white in dark mode.
    className={cn("fixed inset-0 z-50 bg-black/50", className)}
    {...props}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    /** Portal target — see `DialogContent`'s `container` for why it exists. */
    container?: HTMLElement | null;
  }
>(({ className, container, ...props }, ref) => (
  <AlertDialogPortal {...(container ? { container } : {})}>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
        "border-2 border-border bg-card p-6 text-card-foreground shadow-lg",
        "max-h-svh overflow-y-auto",
        // NOTE: no × affordance by design — the operator answers with Cancel or
        // the action, never by clicking the decision away.
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}
AlertDialogHeader.displayName = "AlertDialogHeader";

function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-extrabold text-foreground", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & {
    variant?: "default" | "destructive";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants({ variant }), className)}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
