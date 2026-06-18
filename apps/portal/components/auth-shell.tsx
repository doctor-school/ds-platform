"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { AuthLayout } from "@ds/design-system/blocks";

/**
 * `<AuthShell>` (#237) — the portal-side i18n glue around the design-system
 * `<AuthLayout>` block. It supplies the localized Doctor.School brand copy for the
 * split-screen panel so the four auth surfaces (login / register / verify / reset)
 * don't each repeat the brand props. The block stays copy-free (i18n is app glue);
 * this component owns the `next-intl` lookups, the surface passes only its form card
 * as `children`.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  return (
    <AuthLayout
      brandName={t("brandName")}
      headline={t("panelHeadline")}
      highlights={[t("highlight1"), t("highlight2"), t("highlight3")]}
      footnote={t("footnote")}
    >
      {children}
    </AuthLayout>
  );
}
