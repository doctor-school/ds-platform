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
 * Logo asset: `public/brand/logo.png` (the colored wordmark, trimmed to its content
 * box) — copied from the Doctor School brand book (`apps/docs/brandbook/logo`, brand →
 * token map §6). Shown as-is on the white form column; on the blue brand panel it sits
 * on a white token chip (`bg-card`) so the colored mark keeps its contrast on blue
 * (the brand has no flat single-color logo export, and a CSS-inverted bitmap renders
 * the thin wordmark strokes hollow). Served `unoptimized` — it is a tiny static asset,
 * so the Next image re-encode adds nothing. Intrinsic sizes feed `next/image`; `h-*
 * w-auto` scales for display.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("brand");
  return (
    <AuthLayout
      logo={
        <Image
          src="/brand/logo.png"
          alt={t("logoAlt")}
          width={1511}
          height={496}
          priority
          unoptimized
          className="h-10 w-auto"
        />
      }
      aside={
        <>
          {/* Decorative brand mark — the headline carries the accessible name, so the
              panel logo is presentational (empty alt). On a white token chip so the
              colored logo keeps contrast against the blue panel. */}
          <div className="inline-flex w-fit rounded-xl bg-card p-4 shadow-sm">
            <Image
              src="/brand/logo.png"
              alt=""
              width={1511}
              height={496}
              unoptimized
              className="h-12 w-auto"
            />
          </div>
          <div className="space-y-4">
            <p className="text-3xl font-semibold leading-tight">
              {t("headline")}
            </p>
            <p className="text-lg leading-snug opacity-90">{t("subcopy")}</p>
          </div>
          <p className="text-sm opacity-80">{t("footer")}</p>
        </>
      }
    >
      {children}
    </AuthLayout>
  );
}
