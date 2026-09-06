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
 * here exactly as it is in every other doctor component. And the shell holds no
 * authenticated-redirect guard: the frame is shared by both doors and the answer is
 * not — `/login` sends a signed-in doctor to its own computed landing (#1955,
 * `app/(auth)/login/page.tsx`, on `lib/shell-auth.ts`) while `/register` still
 * renders — so the decision lives with the route that owns the landing, never in
 * the frame around it.
 *
 * With no client hooks the component is server-safe (no `"use client"`), like the
 * block it composes; the nested form carries its own client boundary.
 *
 * Logo assets are SVG (ADR-0013 §8 — vector, not raster) and served `unoptimized`:
 * a tiny static vector needs no Next re-encode. The intrinsic size is the
 * wordmark's viewBox (500×164); `h-* w-auto` scales the display size. The block
 * renders exactly one lockup per viewport — the form-column mark below
 * `layout:`, the brand-panel mark above it, where the panel's blue fill is the
 * same in either theme and the clean white variant needs no chip and no CSS
 * colour-inversion on it.
 *
 * THE FORM-COLUMN MARK FOLLOWS THE THEME (#1955). Below `layout:` there is no
 * blue panel: the lockup sits on the PAGE background, which the dark theme
 * paints near-black — and `logo.svg` is dark ink, so a doctor who had chosen
 * dark met a wordmark that had all but vanished into it. Both assets are
 * rendered and the theme picks, through the app's class-based `dark:` variant
 * (`app/globals.css`, keyed on the `.dark` class `lib/theme.ts` toggles) — an
 * explicit visitor choice, never the OS preference. Exactly one is ever visible,
 * so the one-mark-per-viewport contract (#237/#275) is unchanged: this is a
 * SWAP, not a second mark. `hidden`/`block` are stock Tailwind display
 * utilities and carry no colour value, so nothing here leaves the token
 * pipeline.
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
        <>
          {/* Dark ink on the light page. */}
          <Image
            src="/brand/logo.svg"
            alt="Doctor.School"
            width={500}
            height={164}
            priority
            unoptimized
            className="h-10 w-auto dark:hidden"
            data-testid="auth-wordmark"
          />
          {/* The same lockup in white, for the dark page behind it. The alt text
              is identical because it is the SAME mark — a reader on either theme
              hears «Doctor.School» once, never twice and never differently. */}
          <Image
            src="/brand/logo-white.svg"
            alt="Doctor.School"
            width={500}
            height={164}
            unoptimized
            className="hidden h-10 w-auto dark:block"
            data-testid="auth-wordmark-dark"
          />
        </>
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
