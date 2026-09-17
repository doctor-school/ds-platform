import { headers } from "next/headers";
import type { ReactNode } from "react";

import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_ROUTES } from "@/lib/auth-flow-routes";

/**
 * #675 / 003 EARS-28 — `/reset` runs the SAME guard as the other three auth
 * routes and is let through by it, because it is on this host's
 * `routes.allowAuthenticated`. The exemption is a stated host value rather than
 * a route that simply skips the check: a surface with no guard at all is
 * indistinguishable from one whose guard was forgotten.
 */
export default async function ResetLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: ACADEMY_AUTH_ROUTES.reset,
    routes: ACADEMY_AUTH_ROUTES,
  });
  return <>{children}</>;
}
