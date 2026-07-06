import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `<AuthLayout>` (#237, re-skinned to the neo-brutalist split-shell in #517) — the
 * split-screen chrome the four portal auth surfaces (login / register / verify /
 * reset) compose into: a centered form column plus a brand panel, the approved
 * reference look for every future auth surface (design-approval Stage A).
 *
 *   ┌───────────────┬───────────────┐
 *   │  brand panel  │   logo        │   ← layout: two columns (≥ 901px)
 *   │ (primary-surf)│   [AuthCard]  │
 *   └───────────────┴───────────────┘
 *   The split engages at the semantic `layout` breakpoint (`--breakpoint-layout` =
 *   901px, §09) — the token match for the canvas `≤900px` single-column fold, not the
 *   generic `lg` (1024px). Column order is a recorded product-owner decision (#237):
 *   brand panel LEFT, form RIGHT. The form column stays first in source order (a11y:
 *   the interactive surface precedes the decorative panel) and is flipped visually at
 *   `layout:` with `layout:order-2` / the panel `layout:order-1`. Below the layout
 *   breakpoint the brand panel is hidden and the form column fills the screen, with the
 *   logo kept above the card so narrow viewports still carry the brand. At `layout:`
 *   that form-column logo is hidden (`layout:hidden`) so the brand-panel mark is the
 *   single logo per viewport — the two never both render (the #237/#275 duplicate-logo
 *   fix). With no `aside` (form-only fallback) the logo stays on every breakpoint.
 *
 * Presentation scaffold ONLY: every visible string and asset is app-supplied — the
 * `logo` and the brand-panel `aside` (localized headline / sub-copy / art) are
 * passed in, so no copy or asset path lives in the package (the same i18n contract
 * as `<AuthCard>` / `<OtpFocusScreen>`). RSC: no client hooks, so NO `"use client"`
 * — it is server-safe; the interactive form the app nests carries its own.
 *
 * The brand panel is filled with the semantic `primary-surface` token (Doctor School
 * brand blue.700 #114D9E — the AA-safe brand fill, white 8.14:1) via
 * `bg-primary-surface` / `text-primary-foreground`, never a hardcoded color (the lint
 * guardrails block arbitrary values). It carries normal-weight white copy (sub-copy /
 * footer), so it must NOT use `primary` (blue.500, 3.69:1) which only clears AA for
 * large/bold text (ADR-0013 §7). Omit `aside` for a plain, centered form-only screen
 * (the panel is then not rendered at all).
 */
export function AuthLayout({
  logo,
  aside,
  className,
  children,
}: {
  /** Brand lockup rendered above the form card. On mobile (panel hidden) it carries
   *  the brand; on lg+ it is hidden when a `aside` panel is present so there is exactly
   *  one logo per viewport. With no `aside` it stays visible on every breakpoint. */
  logo?: React.ReactNode;
  /** Brand-panel content (app-supplied, localized headline / sub-copy / art).
   *  When omitted the panel is not rendered and the form fills the screen. */
  aside?: React.ReactNode;
  className?: string;
  /** The auth form for this surface (an `<AuthCard>`). */
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid min-h-screen layout:grid-cols-2", className)}>
      {/* Form column — centered, with the logo above the card. First in source order
          for a11y; flipped to the RIGHT at `layout:` (`layout:order-2`) so the brand
          panel sits on the left per the recorded #237 column-order decision. */}
      <div className="flex flex-col items-center justify-center gap-8 px-6 py-12 layout:order-2">
        {logo ? (
          <div className={cn("w-full max-w-md", aside ? "layout:hidden" : undefined)}>
            {logo}
          </div>
        ) : null}
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Brand panel — the branded surface (token fill). Hidden below the `layout`
          breakpoint, where the form column fills the screen and the logo above carries
          the brand. At `layout:` it takes the LEFT column (`layout:order-1`) per the
          recorded #237 decision. */}
      {aside ? (
        <aside className="hidden flex-col justify-between gap-8 bg-primary-surface p-12 text-primary-foreground layout:order-1 layout:flex">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}
