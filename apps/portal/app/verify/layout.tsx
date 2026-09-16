import { headers } from "next/headers";
import type { ReactNode } from "react";

import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_ROUTES } from "@/lib/auth-flow-routes";

/** #675 — the signed-in guard for `/verify`; see `app/login/layout.tsx`. */
export default async function VerifyLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    // `verify` is optional on the shared route table (a host may confirm
    // inline); the Academy serves the standalone surface, so it is set here.
    pathname: ACADEMY_AUTH_ROUTES.verify,
    routes: ACADEMY_AUTH_ROUTES,
  });
  return <>{children}</>;
}
