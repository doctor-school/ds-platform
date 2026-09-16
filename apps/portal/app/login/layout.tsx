import { headers } from "next/headers";
import type { ReactNode } from "react";

import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_ROUTES } from "@/lib/auth-flow-routes";

/**
 * #675 — an already-authenticated visitor never sees the sign-in form.
 *
 * SERVER-side, in a layout, and that placement is the decision (#2027 PR 1.4,
 * wave-1 gate rows 26–28 / Q3). Until this PR the Academy made the call in a
 * client hook (`lib/use-redirect-if-authenticated.ts`), which necessarily paints
 * first and decides second; the doctor storefront already decided on the server.
 * One mechanism now serves both, and it runs before any of the surface renders.
 *
 * A LAYOUT rather than the page because the four Academy auth pages are
 * `"use client"` surfaces (1.5–1.8 own their bodies): the layout is the server
 * boundary that wraps them without touching them.
 */
export default async function LoginLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: ACADEMY_AUTH_ROUTES.login,
    routes: ACADEMY_AUTH_ROUTES,
  });
  return <>{children}</>;
}
