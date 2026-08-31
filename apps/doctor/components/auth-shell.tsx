import type { ReactNode } from "react";
import Image from "next/image";

import { AuthLayout } from "@ds/design-system/blocks";

/**
 * `<AuthShell>` — the doctor-storefront auth frame: the CHROMELESS page the
 * `design-source/auth.dc.html` `#d-register` artboard draws. The canvas composes
 * the auth screens as a full-viewport split — brand panel beside a form column
 * that carries the wordmark at its top and the card centred on the vertical axis
 * — and it carries NO site header, navigation or footer. That absence is the
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
export function AuthShell({ children }: { children: ReactNode }) {
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
        <div
          data-testid="auth-brand-panel"
          className="flex flex-1 flex-col justify-center"
        >
          {/* Decorative brand mark — the headline carries the accessible name,
              so the panel logo is presentational (empty alt). */}
          <Image
            src="/brand/logo-white.svg"
            alt=""
            width={500}
            height={164}
            unoptimized
            className="mb-10 h-12 w-auto"
            data-testid="auth-panel-wordmark"
          />
          <p className="mb-5 text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
            Врачи учат врачей
          </p>
          <p className="max-w-lg text-4xl font-extrabold leading-tight tracking-tight text-balance">
            Учитесь у практикующих врачей
          </p>
          <p className="mt-6 max-w-md text-base font-medium leading-relaxed text-primary-surface-muted">
            {/*
              The canvas reads «… от практикующих врачей 38 школ.» The count has
              no source in the read model, and the 017 precedent
              (`storefront-hero.tsx` / `scale-counters.tsx`) omits a counter with
              no source rather than hardcoding one. Dropped, not zeroed.
            */}
            Бесплатные эфиры, записи и сертификаты НМО — от практикующих врачей.
          </p>
        </div>
      }
    >
      {children}
    </AuthLayout>
  );
}
