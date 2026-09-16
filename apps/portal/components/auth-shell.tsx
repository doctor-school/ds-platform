"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { AuthShell as AuthShellBlock } from "@ds/design-system/blocks";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * `<AuthShell>` (#237) — the portal-side projection of the shared
 * `@ds/design-system/blocks` `<AuthShell>`. The four auth surfaces (login /
 * register / verify / reset) each wrap their `<AuthCard>` in this shell, so the
 * approved reference look is applied once and consistently.
 *
 * WHAT IS LEFT HERE. The frame — the split-screen chrome and the canvas brand
 * panel (mark · value prop · footer) — is the ONE shared block since #1666 slice C
 * (ADR-0013 A1 cross-front reuse); `apps/doctor` projects the same block. This file
 * keeps exactly what the package refuses to hold: the EARS-17 SmartCaptcha
 * processing disclosure rendered under the card, the
 * localized `brand` copy (i18n stays in the app, never the package — the same
 * contract as the field/block primitives) and the brand assets.
 *
 * Stage A design-approval pick (#237): shadcn `login-03` split — a centered form
 * card beside a brand panel; on narrow viewports the panel is hidden and the form
 * fills the screen with the logo kept above it.
 *
 * Logo assets (SVG, ADR-0013 §8 asset-format policy — vector, not raster): the
 * Doctor School wordmark re-exported clean from the brand vector source (no
 * construction grid). `public/brand/logo.svg` is the colour lockup on the white form
 * column; `public/brand/logo-white.svg` is the clean white variant placed *directly*
 * on the blue brand panel — no `bg-card` chip and no CSS colour-inversion (a clean
 * white vector exists, so the chip was an unnecessary workaround). Exactly one logo
 * per viewport: the block hides the form-column logo when a panel is present, so
 * desktop shows only the panel mark and mobile only the form-top colour logo. Served
 * `unoptimized` — a tiny static SVG needs no Next re-encode; intrinsic sizes feed
 * `next/image` (viewBox 500×164), `h-* w-auto` scales display.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("brand");
  const smartCaptchaConfigured = Boolean(
    process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY,
  );
  // #675 is NOT decided here any more. The signed-in visitor is turned away
  // SERVER-side, in each route's layout (`app/<route>/layout.tsx` →
  // `@ds/auth-flow/server` `guardAuthRoute`), so no auth chrome is rendered and
  // there is no client round-trip to flash through first (#2027 PR 1.4).
  return (
    <AuthShellBlock
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
      panelMark={
        /* Decorative brand mark — the headline carries the accessible name, so the
           panel logo is presentational (empty alt). The clean white logo sits
           directly on the blue panel (no chip, no inversion); the block pins it to
           the top-left of the panel and the value prop below centres itself in the
           remaining space, so there is no dead gap between the mark and the
           headline. */
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
        eyebrow: t("eyebrow"),
        headline: t("headline"),
        subcopy: t("subcopy"),
        footer: t("footer"),
      }}
    >
      {children}
      {smartCaptchaConfigured ? (
        <p
          className="mt-3 text-center text-xs text-muted-foreground"
          data-testid="smartcaptcha-disclosure"
        >
          {t("captchaDisclosure")}{" "}
          <DsLink
            href="https://yandex.com/legal/smartcaptcha_notice/"
            variant="standalone"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("captchaDisclosureLinkLabel")}
          >
            {t("captchaDisclosureLink")}
          </DsLink>
        </p>
      ) : null}
    </AuthShellBlock>
  );
}
