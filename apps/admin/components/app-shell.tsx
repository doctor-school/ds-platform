"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLogout } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Button, Link as DsLink } from "@ds/design-system";

/**
 * The thin admin chrome — brand eyebrow + a sign-out affordance — wrapping every
 * authenticated page. Stock layout on @ds/design-system tokens (007 EARS-11): no
 * bespoke element, copy from the RU catalog (EARS-10). Sign-out routes through the
 * Refine `useLogout` binding → `authProvider.logout` → the 011 admin-tier
 * `POST /v1/admin/auth/logout` (which clears ONLY the admin cookie pair — a
 * concurrent doctor-portal session is deliberately untouched, EARS-2).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { mutate: logout } = useLogout();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        {/* The chrome row wraps whenever its content no longer fits (#1222) —
            `flex-wrap` is width-keyed, not breakpoint-keyed: with the current
            labels the row breaks at roughly 551px of content box, which is why
            it stays a single row on every viewport at and above `sm` but not
            because any `sm:` class switches it. Unwrapped, the
            brand + three nav links + sign-out measured ~503px, so at 390px the
            page itself scrolled sideways: «Выйти» was cut off at the edge, and —
            worse — a horizontal swipe moved the whole page instead of the events
            table, which defeated that table's own `overflow-x-auto` and made its
            trailing columns effectively unreachable. Killing the page-level
            overflow is what hands the table back its scroll. Wherever the row
            fits, it renders exactly as before. */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="text-sm font-semibold text-primary-action">
                {t("app.brand")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("app.eyebrow")}
              </p>
            </div>
            {/* Resource navigation. Added with the second resource (#1283): with
                only events there was nowhere to navigate TO, and a one-item nav
                would have been chrome without a function. */}
            <nav className="flex items-center gap-5 text-sm">
              <DsLink asChild variant="standalone">
                <Link href="/events" data-testid="nav-events">
                  {t("app.nav.events")}
                </Link>
              </DsLink>
              <DsLink asChild variant="standalone">
                <Link href="/projects" data-testid="nav-projects">
                  {t("app.nav.projects")}
                </Link>
              </DsLink>
              <DsLink asChild variant="standalone">
                <Link href="/experts" data-testid="nav-experts">
                  {t("app.nav.experts")}
                </Link>
              </DsLink>
            </nav>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="sign-out"
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
