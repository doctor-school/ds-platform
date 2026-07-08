"use client";

import type { ReactNode } from "react";
import { useLogout } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Button } from "@ds/design-system";

/**
 * The thin admin chrome — brand eyebrow + a sign-out affordance — wrapping every
 * authenticated page. Stock layout on @ds/design-system tokens (007 EARS-11): no
 * bespoke element, copy from the RU catalog (EARS-10). Sign-out routes through the
 * Refine `useLogout` binding → the 003 `/v1/auth/logout` BFF.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { mutate: logout } = useLogout();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-primary-action">
              {t("app.brand")}
            </p>
            <p className="text-xs text-muted-foreground">{t("app.eyebrow")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => logout()}
          >
            {t("app.signOut")}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
