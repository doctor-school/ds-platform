import type { ReactNode } from "react";
import Image from "next/image";

import { AuthShell as AuthShellBlock } from "@ds/design-system/blocks";

/**
 * `<AuthShell>` — the doctor-storefront projection of the shared
 * `@ds/design-system/blocks` `<AuthShell>`: the CHROMELESS auth page the
 * `design-source/auth.dc.html` `#d-register` artboard draws. The canvas composes
 * the auth screens as a full-viewport split — a brand panel (mark pinned top-left,
 * value prop centred in the remaining space, the panel's own footer line) beside a
 * form column holding the card centred on the vertical axis — and it carries NO site
 * header, navigation or footer. Exactly ONE wordmark shows per viewport (#237/#275):
 * the panel mark above the `layout:` breakpoint, the form-column lockup below it,
 * where the panel is not rendered at all — the canvas likewise draws its brand panel
 * on the desktop artboard only. The chromelessness is the design decision, not an
 * omission: the door is a single-CTA surface, and the storefront's own nav cluster
 * would lead the doctor away from the form.
 *
 * WHAT IS LEFT HERE. The frame itself — split grid, three-zone panel, mark
 * alignment, typography, `returnContext` swap — now lives ONCE in the block
 * (#1666 slice C, ADR-0013 A1 cross-front reuse); this file is the thin host
 * projection and holds only what the package refuses to hold: the brand assets and
 * the copy. There is no `next-intl` lookup — `apps/doctor` is a single-locale RU app
 * whose root layout ships no provider (see `app/layout.tsx`), so the copy is literal
 * here exactly as it is in every other doctor component. And there is no
 * authenticated-redirect guard: `apps/portal`'s exists because its auth routes are
 * the session's own entry point, while the storefront resolves the visitor's session
 * in the 017 shell layout (`lib/shell-auth.ts`) — a doctor-side guard belongs with
 * the slice that gains a session to redirect, never as scaffolding here.
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
   * half when the doctor arrived from a content gate. The block stands it in the
   * brand panel's middle zone, taking the place of the value prop rather than
   * stacking above it, and widens the split; unsupplied ⇒ the value prop renders
   * and nothing is reserved for the context (EARS-3).
   */
  returnContext?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthShellBlock
      returnContext={returnContext}
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
      panelMark={
        /* Decorative brand mark — the headline carries the accessible name, so the
           panel logo is presentational (empty alt). The clean white logo sits
           directly on the blue panel (no chip, no inversion); the block pins it to
           the top-left of the panel. */
        <Image
          src="/brand/logo-white.svg"
          alt=""
          width={500}
          height={164}
          unoptimized
          className="h-12 w-auto"
          data-testid="auth-panel-wordmark"
        />
      }
      copy={{
        eyebrow: "Врачи учат врачей",
        headline: "Учитесь у практикующих врачей",
        /*
          The canvas reads «… от практикующих врачей 38 школ.» The count has no
          source in the read model, and the 017 precedent (`storefront-hero.tsx` /
          `scale-counters.tsx`) omits a counter with no source rather than
          hardcoding one. Dropped, not zeroed.
        */
        subcopy:
          "Бесплатные эфиры, записи и сертификаты НМО — от практикующих врачей.",
        /* The panel's own closing line, verbatim from the canvas — not site
           chrome: the route stays chromeless and this line lives inside the brand
           panel, which the block renders only above `layout:`. */
        footer: "Бесплатно для врача · без бюрократии · © Doctor.School 2026",
      }}
    >
      {children}
    </AuthShellBlock>
  );
}
