import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist badge (#513, source §05 "Бейдж «в эфире»" / "Спикер"). Two looks:
 *
 *   • `live`            a flat danger-red tag with a pulsing white dot — the
 *                       "в эфире" live indicator. Fill = `live` (#C81E1E,
 *                       INVARIANT across themes, source's `danger`/`live`
 *                       constant), copy + dot = `live-foreground` (white). The
 *                       leading 7px dot (`size-1.75`, the only round shape) pulses
 *                       on `animate-live-pulse` (1.6s). role defaults to `status`.
 *   • `success`         the pale-green result plate — 014's «Запись доступна»
 *                       (`webinar-archive` canvas). Same geometry as `label`,
 *                       green ink so a positive outcome reads apart from a
 *                       neutral meta tag at a glance.
 *   • `updated`         the pale `tint` «обновлено» flag on a documents-list row
 *                       (028 EARS-11) — a boolean marker, never a version number.
 *   • `label`/`speaker` the pale `tint` tag with `tint-foreground` copy (a meta
 *                       tag / speaker chip); identical visual, two names for intent.
 *
 * Shared: 11px micro-label → `text-2xs` weight 800, UPPERCASE, `tracking-micro`
 * (the foundation's normalised micro tracking, +0.12em), square. Token-only.
 */
const badgeVariants = cva(
  "inline-flex items-center text-2xs font-extrabold uppercase tracking-micro",
  {
    variants: {
      variant: {
        live: "gap-1.75 bg-live px-3 py-1.5 text-live-foreground",
        // A POSITIVE result rather than a status: 014's «Запись доступна» plate
        // (the `webinar-archive` canvas paints it green against the same poster
        // the pale `label` sits on, so the two read apart at a glance).
        //
        // The pairing is `success-tint` + `success-text`, NOT the `success` fill
        // with `success-foreground`: white on green.500 is 3.68:1, which is AA
        // only for large/bold copy, and this badge is 11px (`text-2xs`) — the
        // canvas's green had to survive the badge's own type scale, so it lands
        // as the pale-green plate with the darker green ink the token docs
        // designate for exactly this (light 4.96:1, dark 8.81:1).
        success: "bg-success-tint px-3 py-1.5 text-success-text",
        // 028 EARS-11 (#1966, canvas `design-source/document.dc.html` L245-247):
        // the «обновлено» chip on a documents-list row. Same pale `tint` plate as
        // `label` on a tighter inset, because it rides INSIDE a row title line
        // next to the document name rather than standing alone as a meta tag.
        //
        // It is a FLAG, never a version: the block that renders it takes a
        // host-fed boolean and this variant carries no date and no number — EARS-11
        // forbids a numeric version anywhere on the surface, and how long the chip
        // stays visible after a re-publication is an open product decision
        // (DEBT.md, PR #1971), so no window is baked in here.
        updated: "bg-tint px-2 py-1 text-tint-foreground",
        label: "bg-tint px-2.5 py-1.5 text-tint-foreground",
        speaker: "bg-tint px-2.5 py-1.5 text-tint-foreground",
      },
    },
    defaultVariants: { variant: "label" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "label", children, role, ...props }, ref) => (
    <span
      ref={ref}
      // A live badge is a status indicator — announce it politely by default
      // (overridable via `role`); the tint tags are inert labels.
      role={role ?? (variant === "live" ? "status" : undefined)}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {variant === "live" ? (
        <span
          aria-hidden="true"
          className="size-1.75 rounded-full bg-live-foreground animate-live-pulse"
        />
      ) : null}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
