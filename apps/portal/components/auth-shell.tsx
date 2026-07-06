"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { AuthLayout } from "@ds/design-system/blocks";

/**
 * `<AuthShell>` (#237) — the portal-side glue that fills the design-system
 * `<AuthLayout>` split-screen block with the Doctor School brand: the wordmark logo
 * above the form column and a branded panel (logo + headline + sub-copy) on the
 * right. The block owns the responsive chrome + the `bg-primary` panel fill (token);
 * THIS app layer owns the brand assets and the localized copy (i18n stays in the
 * app, never the package — the same contract as the field/block primitives).
 *
 * Stage A design-approval pick (#237): shadcn `login-03` split — a centered form
 * card beside a brand panel; on < lg the panel is hidden and the form fills the
 * screen with the logo kept above it. The four auth surfaces (login / register /
 * verify / reset) each wrap their `<AuthCard>` in this shell, so the reference look
 * is applied once and consistently.
 *
 * Logo assets (SVG, ADR-0013 §8 asset-format policy — vector, not raster): the
 * Doctor School wordmark re-exported clean from the brand vector source (no
 * construction grid). `public/brand/logo.svg` is the colour lockup on the white form
 * column; `public/brand/logo-white.svg` is the clean white variant placed *directly*
 * on the blue brand panel — no `bg-card` chip and no CSS colour-inversion (a clean
 * white vector exists, so the chip was an unnecessary workaround). Exactly one logo
 * per viewport: the form-column logo is `lg:hidden` (the block hides it when a panel
 * is present), so desktop shows only the panel mark and mobile only the form-top
 * colour logo. Served `unoptimized` — a tiny static SVG needs no Next re-encode;
 * intrinsic sizes feed `next/image` (viewBox 500×164), `h-* w-auto` scales display.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("brand");
  return (
    <AuthLayout
      logo={
        <Image
          src="/brand/logo.svg"
          alt={t("logoAlt")}
          width={500}
          height={164}
          priority
          unoptimized
          className="h-10 w-auto"
        />
      }
      aside={
        <>
          {/* Decorative brand mark — the headline carries the accessible name, so the
              panel logo is presentational (empty alt). The clean white logo sits
              directly on the blue panel (no chip, no inversion). Pinned to the top of
              the panel; the value-prop below grows to centre itself in the remaining
              space (see the `flex-1` group), so there is no dead gap between the mark
              and the headline. */}
          <Image
            src="/brand/logo-white.svg"
            alt=""
            width={500}
            height={164}
            unoptimized
            className="h-12 w-auto"
          />
          {/* Value prop — grows to fill the gap between the top mark and the bottom
              footer and centres itself there, so the panel reads as a deliberate
              three-zone split rather than an even distribution with a void up top.
              #518: composed to the canvas panel shape (`auth.dc.html`, mirrored by the
              showcase `NeutralAside`) — an eyebrow caps-label above a heavy headline +
              sub-copy. Quiet tiers use element `opacity`, never a foreground-token
              opacity (the aa-contrast rule), and copy inherits the block's own
              `text-primary-surface-foreground`. */}
          <div className="flex flex-1 flex-col justify-center gap-5">
            <p className="text-eyebrow font-extrabold uppercase tracking-micro opacity-80">
              {t("eyebrow")}
            </p>
            <p className="max-w-lg text-3xl font-extrabold leading-tight tracking-tight">
              {t("headline")}
            </p>
            <p className="max-w-md text-lg leading-snug opacity-90">
              {t("subcopy")}
            </p>
          </div>
          <p className="text-sm font-semibold opacity-80">{t("footer")}</p>
        </>
      }
    >
      {children}
    </AuthLayout>
  );
}
