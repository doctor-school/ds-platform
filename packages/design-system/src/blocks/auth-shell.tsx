import * as React from "react";

import { AuthLayout } from "./auth-layout";

/** The panel's three-zone copy, host-supplied and already localized. */
export type AuthShellCopy = {
  eyebrow: React.ReactNode;
  headline: React.ReactNode;
  subcopy: React.ReactNode;
  footer: React.ReactNode;
};

export type AuthShellProps = {
  /** Brand lockup above the form card (host asset). Rendered below the `layout:`
   *  breakpoint only — above it the panel mark is the single logo per viewport. */
  logo?: React.ReactNode;
  /** The panel's own brand mark (host asset), pinned top-left in zone 1. It is
   *  decorative — the headline carries the accessible name — so the host passes a
   *  presentational image (empty alt). The block wraps it in the `self-start`
   *  box and nothing else — the asset keeps whatever attributes the host puts on
   *  it, including the `auth-panel-wordmark` testid both storefronts set. */
  panelMark?: React.ReactNode;
  /** The panel copy (see `AuthShellCopy`). */
  copy: AuthShellCopy;
  /**
   * 021 EARS-2 (#1538) — the return-context block that stands in the panel's
   * middle zone when the visitor arrived from a content gate. It takes the place
   * of the value prop rather than stacking above it: the canvas draws exactly one
   * of the two (`showBrandPanel = !gateCardOnPanel`), because the panel's job on
   * that arrival is to name what the visitor is one step away from, not to
   * re-pitch the platform to someone already convinced. Supplying it also WIDENS
   * the split (`shellCols = gateCardOnPanel ? '1.1fr .9fr'`) — the panel is then
   * showing content, and it needs the room a card takes. Unsupplied ⇒ the value
   * prop renders and nothing is reserved for the context (EARS-3).
   */
  returnContext?: React.ReactNode;
  className?: string;
  /** The auth form for this surface (a slice-A/B auth card), plus any host-owned
   *  chrome that belongs under it (the portal's SmartCaptcha disclosure). */
  children: React.ReactNode;
};

/**
 * `<AuthShell>` (#1666 slice C) — the ONE canonical auth frame both storefronts
 * mount: the `design-source/auth.dc.html` brand panel composed into
 * `<AuthLayout>`. It is the cross-front-reuse counterpart of slices A/B
 * (`LoginCard` / `PasswordRecoveryCard` / `EmailConfirmCard`, #1889 / #1902) —
 * those own the CARD inside the frame, this owns the FRAME around it.
 *
 * Until this slice `apps/portal/components/auth-shell.tsx` and
 * `apps/doctor/components/auth-shell.tsx` were two hand-maintained copies of the
 * same three-zone panel (mark · value prop · footer) beside the form column, and
 * they had already drifted apart on typography and on the mark's alignment. The
 * canvas is the decision (ADR-0013 A1, AGENTS.md §6 cross-front reuse), so the
 * canvas-derived doctor composition is what is lifted here verbatim — the mark
 * pinned top-LEFT (`self-start`; without it the aside's `align-items: stretch`
 * widens the image box and the SVG paints centred, out of line with the
 * left-flush copy beneath it), the canvas headline/sub-copy scale, and the panel
 * testids the doctor register e2e asserts. The portal converges onto it.
 *
 * Presentation scaffold ONLY, like `<AuthLayout>` beneath it: every visible
 * string and every asset is host-supplied (`logo`, `panelMark`, `copy`), so no
 * copy, no i18n lookup and no asset path lives in the package. The host
 * projections keep exactly what the block refuses to hold — brand assets,
 * localized copy, and app policy such as the portal's #675
 * authenticated-redirect guard and its EARS-17 SmartCaptcha disclosure (passed
 * in as part of `children`).
 *
 * RSC: no client hooks, so NO `"use client"` — server-safe; the interactive form
 * the host nests carries its own client boundary.
 */
export function AuthShell({
  logo,
  panelMark,
  copy,
  returnContext,
  className,
  children,
}: AuthShellProps) {
  return (
    <AuthLayout
      // `exactOptionalPropertyTypes`: pass `className` only when the host set one,
      // rather than handing the layout an explicit `undefined`.
      {...(className === undefined ? {} : { className })}
      split={returnContext ? "wide-aside" : "even"}
      logo={logo}
      aside={
        /* The canvas panel is a flex column of THREE zones — mark, `flex:1`
           value-prop, footer. This wrapper is that column (it also carries the
           panel testid); it takes `flex-1` so it fills the aside and distributes
           the zones itself. */
        <div data-testid="auth-brand-panel" className="flex flex-1 flex-col">
          {/* Zone 1 — the decorative mark, pinned to the TOP of the panel and flush
              LEFT exactly as the canvas pins it (`align-self:flex-start`). */}
          {panelMark ? <div className="self-start">{panelMark}</div> : null}
          {/* Zone 2 — the return context when the visitor arrived from a gate,
              otherwise the value prop. One or the other, never both. The quiet
              tiers (eyebrow / sub-copy) use the `text-primary-surface-muted`
              token — one weight below the white headline, AA on the blue.700
              panel in both themes (#537). */}
          {returnContext ?? (
            <div className="flex flex-1 flex-col justify-center gap-5">
              <p className="text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
                {copy.eyebrow}
              </p>
              <p className="max-w-lg text-4xl font-extrabold leading-tight tracking-tight text-balance">
                {copy.headline}
              </p>
              <p className="max-w-md text-base font-medium leading-relaxed text-primary-surface-muted">
                {copy.subcopy}
              </p>
            </div>
          )}
          {/* Zone 3 — the panel's own closing line. Not site chrome: the auth route
              stays chromeless, and this line lives inside the brand panel, which
              the layout renders only above `layout:`. */}
          <p className="text-sm font-semibold text-primary-surface-muted">
            {copy.footer}
          </p>
        </div>
      }
    >
      {children}
    </AuthLayout>
  );
}
