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
            fits, it renders exactly as before.

            The shell is `max-w-7xl` because the nav is a seven-section book list
            (#1483 added «Специальности» + «Смежность»): inside the former
            `max-w-5xl` the nav alone measured ~888px of a 976px content box, so
            the brand + nav group no longer left room for «Выйти» and the button
            wrapped onto a second row under the logo on EVERY admin page. `main`
            widens with it so the brand still sits on the page's own left edge.

            «Выйти» is what must never leave the first row, so the brand + nav
            group is the item that gives: `min-w-0 flex-1` lets it shrink below
            its content width, which pushes the overflow into the nav's own
            `flex-wrap` (a second line of links) instead of into the outer row.
            Below ~1280px that is the graceful degrade — nav on two lines, the
            sign-out affordance still top-right where the operator reaches for
            it; at 1280px and up everything is one row again. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-2">
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
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
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
              <DsLink asChild variant="standalone">
                <Link href="/partners" data-testid="nav-partners">
                  {t("app.nav.partners")}
                </Link>
              </DsLink>
              <DsLink asChild variant="standalone">
                <Link href="/directions" data-testid="nav-directions">
                  {t("app.nav.directions")}
                </Link>
              </DsLink>
              {/* The two #1483 relation books sit next to the directions they
                  relate, because that is the only entity either of them is about
                  — a link has no meaning apart from its endpoints. */}
              <DsLink asChild variant="standalone">
                <Link
                  href="/direction-specialties"
                  data-testid="nav-direction-specialties"
                >
                  {t("app.nav.directionSpecialties")}
                </Link>
              </DsLink>
              <DsLink asChild variant="standalone">
                <Link
                  href="/direction-adjacency"
                  data-testid="nav-direction-adjacency"
                >
                  {t("app.nav.directionAdjacency")}
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
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
