import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { StorefrontHeader } from "@ds/storefront-shell";

import { portalNav } from "@/lib/navigation-model";
import { resolveAcademyShellAuth } from "@/lib/shell-auth";
import { academyShellConfig } from "@/lib/shell-config";

/**
 * 008 EARS-1 — the academy storefront's header mount, the single place the
 * shared chrome (`@ds/storefront-shell`, #2180) meets this host's values.
 *
 * A SERVER component end to end, the same shape as the doctor storefront's
 * layout (017 EARS-1): the catalog is read with `getTranslations`, and the
 * sign-in branch is resolved from the request headers by
 * `resolveAcademyShellAuth` (`@ds/auth-flow/server` underneath, #2281), so the
 * chrome arrives with exactly one cluster in the first byte of HTML. Only what
 * is genuinely interactive — the package's theme toggle and mobile disclosure —
 * crosses into the client bundle.
 *
 * The header is mounted from the `@chrome` parallel-route slot (and the footer
 * from the root layout), which is why the package exports the two independently
 * rather than as one `<Shell>` wrapper. Reading `headers()` here makes every
 * route that renders the slot dynamic — the correct trade for a per-visitor
 * header: a statically cached shell would serve one visitor's cluster to
 * everyone. After a login, logout or profile edit the auth flows navigate
 * (`router.push/replace`) or call `router.refresh()`, and the persistent slot is
 * re-rendered on the server with the new state.
 */
export async function AcademyShellHeader() {
  const t = await getTranslations("shell");
  const auth = await resolveAcademyShellAuth(await headers(), {
    login: t(portalNav.login.label),
    profile: t(portalNav.profile.label),
    myEvents: t(portalNav.myEvents.label),
  });

  return <StorefrontHeader config={academyShellConfig(t)} auth={auth} />;
}
