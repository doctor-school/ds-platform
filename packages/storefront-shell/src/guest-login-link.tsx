"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { formatLandOnlyReturnTarget } from "@ds/schemas";
import { Button } from "@ds/design-system/button";

/**
 * 017 EARS-1 · 014 EARS-6 — the sign-in link of the ONE guest control
 * «Войти / Регистрация» brings the visitor back to the page they were on
 * (#2487) — and, unlike the page's own registration button, registers nothing.
 *
 * What rides along is the LAND-ONLY эфир return (`@ds/schemas`
 * `formatLandOnlyReturnTarget`, 014 EARS-6 amendment 2026-09-30): the event page
 * reconstructed by the return whitelist plus the fixed `?intent=land` marker. The
 * visitor comes back to the page and is NEVER registered — the header asks to
 * sign in, not to take part; registration stays the page's own button, whose
 * bare-page return keeps meaning «register me». A page that is no event page —
 * home, a feed, the room, the auth doors themselves (`/login`, `/register`,
 * `/verify`, `/reset`) — carries nothing and the door lands on the surface
 * default, as it would with no target at all. No new validator and no host
 * list: the rule is the one the landing codec already applies. (`@ds/schemas` is read directly because the §4 package graph allows
 * this package `@ds/schemas` and `@ds/design-system` only.)
 */
export function guestLoginHref(
  loginHref: string,
  pathname: string | null | undefined,
): string {
  const landOnly = formatLandOnlyReturnTarget(pathname);
  if (!landOnly) return loginHref;
  const sep = loginHref.includes("?") ? "&" : "?";
  return `${loginHref}${sep}returnTo=${encodeURIComponent(landOnly)}`;
}

/**
 * The client half of the guest cluster: the chrome is mounted from a layout, so
 * only the client knows the page it is drawn on (`usePathname`).
 */
export function GuestLoginLink({
  loginHref,
  label,
}: {
  loginHref: string;
  label: string;
}) {
  const pathname = usePathname();
  return (
    <Button asChild variant="on-primary" size="chip">
      <NextLink
        href={guestLoginHref(loginHref, pathname)}
        data-testid="shell-login"
      >
        {label}
      </NextLink>
    </Button>
  );
}
