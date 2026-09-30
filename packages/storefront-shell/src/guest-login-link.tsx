"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { parseSameOriginReturnTarget } from "@ds/schemas";
import { Button } from "@ds/design-system/button";

/**
 * 017 EARS-1 · 014 EARS-6 — the sign-in link of the ONE guest control
 * «Войти / Регистрация» carries the page the visitor is on as `returnTo`
 * (#2487), so signing in from the header returns them there exactly as the
 * event page's own registration button does.
 *
 * The target is the current PATH run through the platform's one same-origin
 * guard (`parseSameOriginReturnTarget`, `@ds/schemas` — the rule `@ds/auth-flow`
 * `withReturnTarget` applies to its door links): the query and the fragment
 * never ride along, a hostile value is dropped. The guard is read from
 * `@ds/schemas` directly because the §4 package graph allows this package
 * `@ds/schemas` and `@ds/design-system` only. Whether a carried page is a landing is not
 * decided here — the sign-in door's landing codec treats a page that is no
 * return shape (home, a feed) as no target and lands on the surface default.
 *
 * The auth doors themselves (`authPaths`, and any page below one) never carry
 * themselves: the host names them from its own route table.
 */
export function guestLoginHref(
  loginHref: string,
  pathname: string | null | undefined,
  authPaths: readonly string[],
): string {
  if (!pathname) return loginHref;
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  const onDoor = authPaths.some(
    (door) => path === door || path.startsWith(`${door}/`),
  );
  const safe = onDoor ? null : parseSameOriginReturnTarget(pathname);
  if (!safe) return loginHref;
  const sep = loginHref.includes("?") ? "&" : "?";
  return `${loginHref}${sep}returnTo=${encodeURIComponent(safe)}`;
}

/**
 * The client half of the guest cluster: the chrome is mounted from a layout, so
 * only the client knows the page it is drawn on (`usePathname`).
 */
export function GuestLoginLink({
  loginHref,
  authPaths,
  label,
}: {
  loginHref: string;
  authPaths: readonly string[];
  label: string;
}) {
  const pathname = usePathname();
  return (
    <Button asChild variant="on-primary" size="chip">
      <NextLink
        href={guestLoginHref(loginHref, pathname, authPaths)}
        data-testid="shell-login"
      >
        {label}
      </NextLink>
    </Button>
  );
}
