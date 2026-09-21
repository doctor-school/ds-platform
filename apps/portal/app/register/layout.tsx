import { headers } from "next/headers";
import type { ReactNode } from "react";

import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_ROUTES } from "@/lib/auth-flow-routes";

/**
 * #675 — the signed-in guard for `/register`. The decision is taken SERVER-side,
 * here in the layout, before the surface renders: `resolveServerAuth` reads the
 * session off the incoming headers and `guardAuthRoute` (`@ds/auth-flow/server`)
 * redirects a signed-in visitor to this host’s `routes.account`. `/verify` and
 * `/reset` run the same pair in their own layouts; `/login` has no layout of its
 * own because the package `LoginRoute` runs the guard inside the route itself.
 */
export default async function RegisterLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: ACADEMY_AUTH_ROUTES.register,
    routes: ACADEMY_AUTH_ROUTES,
  });
  return <>{children}</>;
}
