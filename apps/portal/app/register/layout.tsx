import { headers } from "next/headers";
import type { ReactNode } from "react";

import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_ROUTES } from "@/lib/auth-flow-routes";

/** #675 — the signed-in guard for `/register`; see `app/login/layout.tsx`. */
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
