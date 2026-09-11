import { headers } from "next/headers";
import type { ReactNode } from "react";
import { StorefrontFooter, StorefrontHeader } from "@ds/storefront-shell";
import { StorefrontAuthCluster } from "@/components/storefront-auth-cluster";
import { DOCTOR_SHELL } from "@/lib/shell-config";
import { resolveShellAuth } from "@/lib/shell-auth";

/**
 * 017 EARS-1 — THE storefront shell layout.
 *
 * This route-group layout is the single definition of the doctor storefront's
 * header, navigation and footer (design §1). Every doctor-facing route of 017
 * and of features 018–021 lives under `app/(storefront)/` and therefore renders
 * inside it; a screen-local re-implementation of any of the three is a defect,
 * not a variation. The group `(storefront)` adds no URL segment — `/` stays `/`.
 *
 * The chrome itself is `@ds/storefront-shell`, owned ONCE for both storefronts
 * (#2180, epic #2020 / ADR-0013 A1). This host supplies only VALUES
 * ({@link DOCTOR_SHELL}) and the auth slot — there is no doctor-local header or
 * footer component any more, which is what stops the two storefronts drifting
 * apart every time either side ships.
 *
 * The sign-in branch is resolved HERE, on the server, from the request headers
 * (`lib/shell-auth.ts` → the `__Host-ds_session` cookie, ADR-0015 §4) and handed
 * to the cluster as data. That is what makes "exactly one action cluster, never
 * a transitional state" true of the first byte of HTML rather than of a settled
 * client effect.
 *
 * Reading `headers()` opts every route in this group into dynamic rendering.
 * That is the correct trade for a per-visitor header: a statically cached shell
 * would serve one visitor's cluster to everyone.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await resolveShellAuth(await headers());

  return (
    <div
      data-testid="storefront-shell"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <StorefrontHeader
        config={DOCTOR_SHELL}
        authCluster={<StorefrontAuthCluster auth={auth} />}
      />
      <main className="flex-1">{children}</main>
      <StorefrontFooter config={DOCTOR_SHELL} />
    </div>
  );
}
