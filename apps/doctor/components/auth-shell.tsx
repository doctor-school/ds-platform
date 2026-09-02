import type { ReactNode } from "react";
import Image from "next/image";

import { AuthLayout } from "@ds/design-system/blocks";

/**
 * `<AuthShell>` — the doctor-storefront auth frame: the CHROMELESS page the
 * `design-source/auth.dc.html` `#d-register` artboard draws. The canvas composes
 * the auth screens as a full-viewport split — a brand panel (mark pinned top-left,
 * value prop centred in the remaining space, the panel's own footer line) beside a
 * form column holding the card centred on the vertical axis — and it carries NO site
 * header, navigation or footer. Exactly ONE wordmark shows per viewport (#237/#275):
 * the panel mark above the `layout:` breakpoint, the form-column lockup below it,
 * where the panel is not rendered at all — the canvas likewise draws its brand panel
 * on the desktop artboard only. The chromelessness is the
 * design decision, not an omission: the door is a single-CTA surface, and the
 * storefront's own nav cluster would lead the doctor away from the form.
 *
 * WHY A DOCTOR-LOCAL COMPONENT AND NOT AN IMPORT. `apps/portal` already renders
 * its auth surfaces chromeless through its own `components/auth-shell.tsx`, and
 * app-to-app imports are forbidden (ADR-0013 A1). The shared half of the pattern
 * is ALREADY extracted — `<AuthLayout>` in `@ds/design-system/blocks` owns the
 * split grid, the vertical centring, the `layout:` (901px) collapse and the
 * one-logo-per-viewport rule. What stays app-local is exactly what the block
 * refuses to hold: the brand assets and the localized copy. So this file mirrors
 * the portal's structure slot for slot (logo → wordmark, aside → brand panel)
 * with the doctor's own copy; #1666 lifts the two into ONE shared `AuthShell`
 * and will find one pattern to extract rather than two divergent frames.
 *
 * Thinner than the portal's in two deliberate ways. There is no `next-intl`
 * lookup — `apps/doctor` is a single-locale RU app whose root layout ships no
 * provider (see `app/layout.tsx`), so the copy is literal here exactly as it is
 * in every other doctor component. And there is no authenticated-redirect guard:
 * the portal's exists because its auth routes are the session's own entry point,
 * while the storefront resolves the visitor's session in the 017 shell layout
 * (`lib/shell-auth.ts`) — a doctor-side guard belongs with the 021 command slice
 * that gains a session to redirect, not with this frame. Both are facilities this
 * app adopts when it gains the surface that needs them, never as scaffolding.
 *
 * With no client hooks the component is server-safe (no `"use client"`), like the
 * block it composes; the nested form carries its own client boundary.
 *
 * Logo assets are SVG (ADR-0013 §8 — vector, not raster) and served `unoptimized`:
 * a tiny static vector needs no Next re-encode. The intrinsic size is the
 * wordmark's viewBox (500×164); `h-* w-auto` scales the display size. The block
 * renders exactly one of the two per viewport — the colour lockup above the card
 * below `layout:`, the clean white variant on the brand panel above it — so no
 * chip and no CSS colour-inversion is needed on the blue fill.
 */
export function AuthShell({
  returnContext,
  children,
}: {
  /**
   * 021 EARS-2 (#1538) — the return-context block that FILLS the split's left
   * half when the doctor arrived from a content gate. It stands in the brand
   * panel's middle zone, taking the place of the value prop rather than
   * stacking above it: the canvas draws exactly one of the two
   * (`showBrandPanel = !gateCardOnPanel`), because the panel's job on this
   * arrival is to name what the doctor is one step away from, not to re-pitch
   * the platform to someone already convinced. Unsupplied ⇒ the value prop
   * renders and nothing is reserved for the context (EARS-3).
   */
  returnContext?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthLayout
      logo={
        <Image
          src="/brand/logo.svg"
          alt="Doctor.School"
          width={500}
          height={164}
          priority
          unoptimized
          className="h-10 w-auto"
          data-testid="auth-wordmark"
        />
      }
      aside={
        /* The canvas panel (`auth.dc.html`, brand panel) is a flex column of THREE
           zones — mark, `flex:1` value-prop, footer — and `apps/portal` mirrors the
           same three into the block's `justify-between` aside. This wrapper is that
           column (it also carries the panel testid); it takes `flex-1` so it fills
           the aside and distributes the zones itself. */
        <div data-testid="auth-brand-panel" className="flex flex-1 flex-col">
          {/* Zone 1 — decorative brand mark, pinned to the TOP of the panel and flush
              LEFT exactly as the canvas pins it (`align-self:flex-start`): without
              `self-start` the aside's default `align-items: stretch` widens the image
              box to the column and the SVG paints centred, out of line with the
              left-flush copy beneath it. The headline carries the accessible name, so
              the mark is presentational (empty alt). */}
          <Image
            src="/brand/logo-white.svg"
            alt=""
            width={500}
            height={164}
            unoptimized
            className="h-12 w-auto self-start"
            data-testid="auth-panel-wordmark"
          />
          {/* Zone 2 — the return context when the doctor arrived from a gate,
              otherwise the value prop. One or the other, never both: the zone is
              the panel's single middle band, and the canvas swaps its content
              rather than stacking two pitches into it. */}
          {returnContext ?? (
          <div className="flex flex-1 flex-col justify-center gap-5">
            <p className="text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
              Врачи учат врачей
            </p>
            <p className="max-w-lg text-4xl font-extrabold leading-tight tracking-tight text-balance">
              Учитесь у практикующих врачей
            </p>
            <p className="max-w-md text-base font-medium leading-relaxed text-primary-surface-muted">
              {/*
                The canvas reads «… от практикующих врачей 38 школ.» The count has
                no source in the read model, and the 017 precedent
                (`storefront-hero.tsx` / `scale-counters.tsx`) omits a counter with
                no source rather than hardcoding one. Dropped, not zeroed.
              */}
              Бесплатные эфиры, записи и сертификаты НМО — от практикующих врачей.
            </p>
          </div>
          )}
          {/* Zone 3 — panel footer, verbatim from the canvas. It is the panel's own
              closing line, not site chrome: the route stays chromeless (no storefront
              header/footer/nav), and this line lives inside the brand panel, which the
              block renders only above `layout:`. */}
          <p className="text-sm font-semibold text-primary-surface-muted">
            Бесплатно для врача · без бюрократии · © Doctor.School 2026
          </p>
        </div>
      }
    >
      {children}
    </AuthLayout>
  );
}
