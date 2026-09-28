"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLogout } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Button, Link as DsLink } from "@ds/design-system";
import {
  adminNavItems,
  canAccessPath,
  landingRedirect,
} from "@/lib/admin-access";
import { useAdminAccess } from "@/lib/use-admin-access";

/**
 * The thin admin chrome — brand eyebrow + a sign-out affordance — wrapping every
 * authenticated page. Stock layout on @ds/design-system tokens (007 EARS-11): no
 * bespoke element, copy from the RU catalog (EARS-10). Sign-out routes through the
 * Refine `useLogout` binding → `authProvider.logout` → the 011 admin-tier
 * `POST /v1/admin/auth/logout` (which clears ONLY the admin cookie pair — a
 * concurrent doctor-portal session is deliberately untouched, EARS-2).
 *
 * 044 EARS-20: the navigation AND the page body are a projection of the
 * principal's own session read (`roles` + `eventGrants`, `lib/admin-access.ts`).
 * A route the principal may not open — every route but its bound roster, for a
 * congress registrar — renders the existing refusal copy in place of the page;
 * the server refuses that page's data regardless (EARS-19/38), so this gate only
 * keeps the screen honest, it never replaces the refusal. A principal with
 * exactly one link who lands on an admin landing it may not open (every sign-in
 * lands on `/events`) is sent to that link instead (`landingRedirect`).
 *
 * Until the session read answers, the chrome renders without nav links and the
 * page body stays empty — no placeholder copy, nothing drawn on a guess.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { mutate: logout } = useLogout();
  const pathname = usePathname();
  const access = useAdminAccess();
  const navItems = access ? adminNavItems(access) : [];
  const router = useRouter();
  const landing = access ? landingRedirect(access, pathname) : null;

  useEffect(() => {
    if (landing) router.replace(landing);
  }, [landing, router]);

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
                would have been chrome without a function. Since 044 EARS-20 the
                links are drawn from the principal's role AND event binding
                (`lib/admin-access.ts`): a platform administrator gets every
                section, a congress registrar exactly its bound event's roster.
                Nothing is drawn until the session read answers, so a registrar
                never sees a flash of sections it cannot open. */}
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {navItems.map((item) => (
                <DsLink key={item.href} asChild variant="standalone">
                  <Link href={item.href} data-testid={item.testId}>
                    {t(item.labelKey)}
                  </Link>
                </DsLink>
              ))}
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
      <main className="mx-auto max-w-7xl px-6 py-8">
        {!access || landing ? null : canAccessPath(access, pathname) ? (
          children
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="access-refused"
          >
            {t("login.errorForbidden")}
          </p>
        )}
      </main>
    </div>
  );
}
