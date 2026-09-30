"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { parseReturnTarget } from "@ds/schemas";
import { Button } from "@ds/design-system/button";

/**
 * 017 EARS-1 · 014 EARS-6 — the sign-in link of the ONE guest control
 * «Войти / Регистрация» brings the visitor back to the page they were on
 * (#2487), exactly as the event page's own registration button does.
 *
 * What rides along is decided by the SAME whitelist the sign-in door lands on:
 * `parseReturnTarget` (`@ds/schemas`, 005 EARS-2 / 021 LD-3) — the эфир return
 * shapes, reconstructed from their validated parts, never the raw path. So an
 * event page carries itself (`/events/<slug>`, `/webinars/<slug>`), while a
 * page that is no return shape — home, a feed, and the auth doors themselves
 * (`/login`, `/register`, `/verify`, `/reset`) — carries nothing and the door
 * lands on the surface default, as it would with no target at all. No new
 * validator and no host list: the rule is the one the landing codec already
 * applies. (`@ds/schemas` is read directly because the §4 package graph allows
 * this package `@ds/schemas` and `@ds/design-system` only.)
 */
export function guestLoginHref(
  loginHref: string,
  pathname: string | null | undefined,
): string {
  const intent = parseReturnTarget(pathname);
  if (!intent) return loginHref;
  const sep = loginHref.includes("?") ? "&" : "?";
  return `${loginHref}${sep}returnTo=${encodeURIComponent(intent.returnTo)}`;
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
