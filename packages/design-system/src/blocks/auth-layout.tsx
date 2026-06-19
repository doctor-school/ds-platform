import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `<AuthLayout>` (#237) — the split-screen chrome the four portal auth surfaces
 * (login / register / verify / reset) compose into. It is the token-only,
 * re-skinned distillation of the shadcn `login-03` block: a centered form column
 * plus a brand panel, the approved reference look for every future auth surface
 * (design-approval Stage A).
 *
 *   ┌───────────────┬───────────────┐
 *   │   logo        │  brand panel  │   ← lg+ : two columns
 *   │   [AuthCard]  │  (bg-primary) │
 *   └───────────────┴───────────────┘
 *   On < lg the brand panel is hidden and the form column fills the screen, with
 *   the logo kept above the card so mobile still carries the brand.
 *
 * Presentation scaffold ONLY: every visible string and asset is app-supplied — the
 * `logo` and the brand-panel `aside` (localized headline / sub-copy / art) are
 * passed in, so no copy or asset path lives in the package (the same i18n contract
 * as `<AuthCard>` / `<OtpFocusScreen>`). RSC: no client hooks, so NO `"use client"`
 * — it is server-safe; the interactive form the app nests carries its own.
 *
 * The brand panel is filled with the semantic `primary` token (Doctor School brand
 * blue, #236) via `bg-primary` / `text-primary-foreground` — never a hardcoded
 * color (the lint guardrails block arbitrary values). Omit `aside` for a plain,
 * centered form-only screen (the panel is then not rendered at all).
 */
export function AuthLayout({
  logo,
  aside,
  className,
  children,
}: {
  /** Brand lockup rendered above the form card — shown on every breakpoint so the
   *  mobile layout (panel hidden) still carries the brand. */
  logo?: React.ReactNode;
  /** Brand-panel content (app-supplied, localized headline / sub-copy / art).
   *  When omitted the panel is not rendered and the form fills the screen. */
  aside?: React.ReactNode;
  className?: string;
  /** The auth form for this surface (an `<AuthCard>`). */
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid min-h-screen lg:grid-cols-2", className)}>
      {/* Form column — centered, with the logo above the card. */}
      <div className="flex flex-col items-center justify-center gap-8 px-6 py-12">
        {logo ? <div className="w-full max-w-md">{logo}</div> : null}
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Brand panel — the branded surface (token fill). Hidden below `lg`, where
          the form column fills the screen and the logo above carries the brand. */}
      {aside ? (
        <aside className="hidden flex-col justify-between gap-8 bg-primary p-12 text-primary-foreground lg:flex">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}
