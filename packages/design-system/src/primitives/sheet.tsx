"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Side panel (record inspector), adopted from **official shadcn/ui `sheet`** (MIT)
 * on its `@radix-ui/react-dialog` substrate — the same substrate as
 * {@link ./dialog.tsx `Dialog`} — and re-skinned to the DS tokens (#2396).
 * Radix owns the focus management, the title/description wiring, Escape and the
 * return of focus to the trigger.
 *
 * WHY: the owner decision on #2377 opens a roster record on the right OVER the
 * roster, keeps the roster visible, walks records with ↑/↓ and closes on Esc; the
 * desk entry form (PR #2399) lives in the SAME panel. So one primitive hosts a
 * read card and a form (header · scrolling body · action footer).
 *
 * MODALITY IS OWNED HERE, per breakpoint, so no consumer re-implements it:
 * - at ≥ `lg` (64rem, `--breakpoint-lg`) it is a NON-modal inspector — Radix
 *   `modal={false}`, no scrim, no `aria-modal`, the page behind stays scrollable
 *   and clickable, and an outside press does NOT dismiss it (choosing another
 *   roster row must not close the panel);
 * - below `lg` it is a MODAL full cover — scrim, focus trap, scroll lock, the page
 *   behind hidden from assistive tech, `aria-modal="true"`.
 * Server render / first paint assume the inspector viewport (the sheet is closed
 * then anyway); `useSyncExternalStore` reads the real match before paint on the
 * client.
 *
 * Deviations from upstream shadcn `sheet`: `top`/`bottom` sides dropped (no
 * consumer), `size` added, `onNavigate` added, the × carries a RU name. Motion:
 * the enter slide is a CSS transition from `@starting-style` (Tailwind
 * `starting:`), keyed on `data-state="open"`, so every render source stays in
 * this file (no new keyframes/tokens); the exit is instant because Radix
 * Presence unmounts at once when no CSS animation runs. `motion-reduce:` drops
 * the transition.
 */
const INSPECTOR_QUERY = "(min-width: 64rem)";

function subscribeInspector(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => {};
  const mq = window.matchMedia(INSPECTOR_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function readInspector(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true;
  return window.matchMedia(INSPECTOR_QUERY).matches;
}

/** `true` at/above `lg` — the non-modal inspector viewport. */
function useInspectorViewport(): boolean {
  return React.useSyncExternalStore(
    subscribeInspector,
    readInspector,
    () => true,
  );
}

const SheetModalContext = React.createContext<boolean>(false);

type SheetProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>,
  "modal"
>;

/** Root. Modality is decided by the viewport (see the header note), not a prop. */
function Sheet(props: SheetProps) {
  const modal = !useInspectorViewport();
  return (
    <SheetModalContext.Provider value={modal}>
      <DialogPrimitive.Root modal={modal} {...props} />
    </SheetModalContext.Provider>
  );
}
Sheet.displayName = "Sheet";

const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

/**
 * Scrim for the MODAL (below-lg) mode only. Theme-invariant `black/50` for the
 * same reason as `DialogOverlay`: a `foreground` scrim inverts to white in dark.
 */
const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-sheet-overlay=""
    className={cn("fixed inset-0 z-50 bg-black/50", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

/**
 * Below lg the panel is a full cover (both insets 0); from lg it detaches from
 * the far edge and takes its `size` width, with a 2px structural edge toward the
 * page. The slide starts off-canvas via `@starting-style`.
 */
const sheetVariants = cva(
  [
    "fixed inset-y-0 z-50 flex w-full flex-col",
    "bg-card text-card-foreground lg:shadow-lg",
    "focus-visible:outline-none",
    "transition-transform duration-200 ease-out motion-reduce:transition-none",
  ],
  {
    variants: {
      side: {
        right:
          "left-0 right-0 lg:left-auto lg:border-l-2 lg:border-border data-[state=open]:starting:translate-x-full",
        left: "left-0 right-0 lg:right-auto lg:border-r-2 lg:border-border data-[state=open]:starting:-translate-x-full",
      },
      size: {
        md: "lg:w-1/3 lg:min-w-90",
        lg: "lg:w-1/2 lg:min-w-120",
      },
    },
    defaultVariants: { side: "right", size: "md" },
  },
);

/**
 * Controls that own ↑/↓ themselves. While focus is in one of these, the arrows
 * belong to the control (caret, option list, stepper), never to record paging.
 */
const ARROW_OWNERS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  ...[
    "combobox",
    "listbox",
    "option",
    "menu",
    "menubar",
    "menuitem",
    "radiogroup",
    "radio",
    "slider",
    "spinbutton",
    "tablist",
    "tab",
    "tree",
    "grid",
  ].map((role) => `[role='${role}']`),
].join(",");

function arrowsOwnedByControl(
  target: EventTarget | null,
  sheet: Element,
): boolean {
  if (!(target instanceof Element)) return false;
  const owner = target.closest(ARROW_OWNERS);
  return owner !== null && sheet.contains(owner);
}

type SheetNavigateDirection = "prev" | "next";

type SheetContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /** Edge the panel docks to from `lg`. Default `right`. */
  side?: "right" | "left" | undefined;
  /** `md` ≈ a third of the viewport (min 360px); `lg` = half (min 480px). */
  size?: "md" | "lg" | undefined;
  /**
   * Record paging: ↑ → `"prev"`, ↓ → `"next"`, fired when focus is on the panel
   * itself or on a non-editable control inside it — never from a field that
   * owns its arrows (input/textarea/select/combobox/listbox…), never with a
   * modifier held. The consumer moves the record (and its URL); the panel stays.
   */
  onNavigate?: ((direction: SheetNavigateDirection) => void) | undefined;
  showCloseButton?: boolean;
  /** Portal target; see `DialogContent.container` (showcase `.dark` panes). */
  container?: HTMLElement | null;
};

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      className,
      children,
      side = "right",
      size = "md",
      onNavigate,
      showCloseButton = true,
      container,
      onKeyDown,
      onInteractOutside,
      ...props
    },
    ref,
  ) => {
    const modal = React.useContext(SheetModalContext);
    return (
      <SheetPortal {...(container ? { container } : {})}>
        {modal ? <SheetOverlay /> : null}
        <DialogPrimitive.Content
          ref={ref}
          data-side={side}
          data-size={size}
          data-modal={modal ? "true" : "false"}
          {...(modal ? { "aria-modal": true } : {})}
          className={cn(sheetVariants({ side, size }), className)}
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            // Inspector mode: the page behind is live — picking another roster
            // row (or focusing it) must not dismiss the panel. Esc / × close it.
            if (!modal) event.preventDefault();
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || !onNavigate) return;
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            if (arrowsOwnedByControl(event.target, event.currentTarget)) return;
            event.preventDefault();
            onNavigate(event.key === "ArrowUp" ? "prev" : "next");
          }}
          {...props}
        >
          {children}
          {showCloseButton ? <SheetCloseButton /> : null}
        </DialogPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = "SheetContent";

/** The × affordance — same look as `DialogContent`'s, pinned to the header row. */
function SheetCloseButton() {
  return (
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
      <span className="sr-only">Закрыть</span>
    </DialogPrimitive.Close>
  );
}

function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b-2 border-border p-6 pr-14",
        className,
      )}
      {...props}
    />
  );
}
SheetHeader.displayName = "SheetHeader";

/**
 * The ONLY scrolling region: header and footer (the actions) never scroll away.
 * It is a tab stop (`tabIndex=0`) because a read card often has no field or
 * link inside it — without one, keyboard users could not scroll a long body
 * (WCAG 2.1.1; axe `scrollable-region-focusable`). Space / PageUp / PageDown /
 * Home / End scroll it; ↑/↓ stay record paging when `onNavigate` is set.
 */
function SheetBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      tabIndex={0}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto p-6",
        "focus-visible:outline-none focus-visible:shadow-focus",
        className,
      )}
      {...props}
    />
  );
}
SheetBody.displayName = "SheetBody";

function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t-2 border-border p-6 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
SheetFooter.displayName = "SheetFooter";

/** REQUIRED by Radix (accessible name); `sr-only` at the call site is fine. */
const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-extrabold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetProps,
  type SheetContentProps,
  type SheetNavigateDirection,
};
