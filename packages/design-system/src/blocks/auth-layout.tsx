import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `<AuthLayout>` (#237) — the branded split-screen shell every auth surface
 * (login / register / verify / reset) composes into. It is the token-only,
 * owned re-expression of the official shadcn **login-02 / login-04** donor
 * pattern (MIT) — a two-column layout: a branded side panel beside a centered
 * form column — re-skinned entirely onto our tokens (no hardcoded color/spacing;
 * the brand fill is the `brand` semantic token = the dark brand blue #114D9E,
 * whose white copy clears AA-normal at any size, unlike `primary`).
 *
 * Presentation scaffold ONLY: every visible string (`brandName`, `headline`, the
 * `highlights`, `footnote`) is an app-supplied, localized prop — no copy and no
 * i18n live in the package (the portal wraps this in `<AuthShell>`). The form,
 * BFF calls, EARS-16 error mapping, routing and validation are app glue passed as
 * `children`. No client hooks here → server-safe, NO `"use client"`.
 *
 * Responsive: the branded panel is hidden below `lg` so the form is the sole
 * priority on small screens; the form column stays centered at every width.
 */
export function AuthLayout({
  brandName,
  headline,
  highlights,
  footnote,
  className,
  children,
}: {
  /** Brand wordmark (app-supplied), shown at the top of the panel. */
  brandName: React.ReactNode;
  /** Panel hero headline (app-supplied, localized). */
  headline?: React.ReactNode;
  /** Trust/value bullets rendered with a check marker (app-supplied, localized). */
  highlights?: React.ReactNode[];
  /** Optional panel footnote (e.g. a copyright line). */
  footnote?: React.ReactNode;
  /** Extra classes for the outer `<main>`. */
  className?: string;
  /** The form-column content (the auth card the surface composes). */
  children: React.ReactNode;
}) {
  return (
    <main className={cn("grid min-h-screen lg:grid-cols-2", className)}>
      {/* Branded panel — hidden below lg (the form is the priority on phones). */}
      <aside className="hidden flex-col justify-between bg-brand p-12 text-brand-foreground lg:flex">
        <div className="text-xl font-semibold tracking-tight">{brandName}</div>

        <div className="space-y-6">
          {headline ? (
            <h2 className="max-w-sm text-3xl font-semibold leading-tight">
              {headline}
            </h2>
          ) : null}

          {highlights && highlights.length > 0 ? (
            <ul className="space-y-3">
              {highlights.map((highlight, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-base text-brand-foreground/90"
                >
                  <CheckMark />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {footnote ? (
          <div className="text-sm text-brand-foreground/80">{footnote}</div>
        ) : (
          <div aria-hidden />
        )}
      </aside>

      {/* Form column — centered at every width. */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}

/**
 * A small check glyph for the highlight bullets, inlined as SVG so the block adds
 * no icon-library dependency (acceptance bar §3.1: no superfluous deps). It
 * inherits `currentColor`, so it tracks the panel's `brand-foreground` text.
 */
function CheckMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-1 size-4 shrink-0"
      aria-hidden
    >
      <path d="m5 10 3.5 3.5L15 6" />
    </svg>
  );
}
