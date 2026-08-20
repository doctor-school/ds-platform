"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "../lib/utils";

/**
 * Modal dialog, adopted from **official shadcn/ui `dialog`** (MIT) on its
 * `@radix-ui/react-dialog` substrate and re-skinned to the DS tokens (#1339,
 * Stage-A record on #1337). Radix owns what is expensive to get right and easy to
 * get wrong: the focus trap, the `aria-modal` / labelled-by wiring, the Escape and
 * outside-press dismissal, the scroll lock, and returning focus to the trigger.
 *
 * WHY A SHARED PRIMITIVE, NOT A LOCAL ONE: feature 014's operator surface needs a
 * modal confirmation on every status-changing recording action (014-design §7) and
 * feature 007's «Отметить завершённым» command (#1338) needs the same one. Per the
 * #1280/#1336 rule the first vertical that needs a shared element class builds it
 * HERE, once, rather than hand-assembling a second overlay per app.
 *
 * DIALOG vs ALERT-DIALOG: this is the DISMISSIBLE one — a form or a detail the
 * operator may walk away from (Escape, the overlay, the × affordance). A
 * destructive/consequential confirmation that must be answered by choosing, not by
 * clicking away, uses {@link ../primitives/alert-dialog.tsx `AlertDialog`}, whose
 * Radix root deliberately refuses outside-press dismissal and takes `role="alertdialog"`.
 *
 * Re-skin (neo-brutalist language, #512/#513, ADR-0013): square corners, a hard
 * 2px structural border, the `shadow-lg` hard offset cast (blur 0), token colours
 * only, and the flush 3px `shadow-focus` ring on every focusable affordance. The
 * scrim is theme-invariant `black/50` on purpose — a scrim keyed to `foreground`
 * would invert to a WHITE veil in dark mode.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Theme-invariant scrim: the dialog surface must read as lifted off the
      // page in BOTH themes, so the veil is black in both (see the header note).
      "fixed inset-0 z-50 bg-black/50",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * The dialog surface. `showCloseButton` exists because the × affordance is right
 * for a walk-away dialog and wrong for a decision that must be made — the
 * `AlertDialog` composition drops it entirely rather than restyling it away.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean;
    /**
     * Portal target. Defaults to `document.body`, which is right for an app: a
     * modal must escape any clipping/stacking ancestor. Supply a node when the
     * dialog must inherit a SCOPED context that only exists inside a subtree —
     * the showcase renders each specimen inside its own `.dark` pane, and a
     * body-level portal would silently render the dark specimen in light.
     */
    container?: HTMLElement | null;
  }
>(
  (
    { className, children, showCloseButton = true, container, ...props },
    ref,
  ) => (
    <DialogPortal {...(container ? { container } : {})}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
          "border-2 border-border bg-card p-6 text-card-foreground shadow-lg",
          // A long confirmation body must never push its own buttons off-screen.
          "max-h-svh overflow-y-auto",
          "focus-visible:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              "absolute right-4 top-4 inline-flex size-8 items-center justify-center",
              "border-2 border-transparent text-muted-foreground transition-colors",
              "hover:border-border hover:bg-tint hover:text-tint-foreground",
              "focus-visible:outline-none focus-visible:shadow-focus",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
              className="size-4"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
            {/* The affordance is an icon; assistive tech still gets a name. */}
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-2 pr-8", className)} {...props} />
  );
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({
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
DialogFooter.displayName = "DialogFooter";

/**
 * REQUIRED by Radix: without a title the dialog has no accessible name and Radix
 * logs a development warning. Visually-hidden is a legitimate use — wrap it in
 * `sr-only` at the call site — but omitting it is not.
 */
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-extrabold text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
