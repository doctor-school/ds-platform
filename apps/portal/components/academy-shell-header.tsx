import { getTranslations } from "next-intl/server";

import { AcademyShellHeaderClient } from "@/components/academy-shell-header-client";
import { portalNav } from "@/lib/navigation-model";
import { academyShellConfig } from "@/lib/shell-config";

/**
 * 008 EARS-1 — the academy storefront's header mount, the single place the
 * shared chrome (`@ds/storefront-shell`, #2180) meets this host's values.
 *
 * It stays a SERVER component: the catalog is read with `getTranslations`, so
 * the chrome's copy is resolved on the server and only what is genuinely
 * interactive crosses into the client bundle — the package's theme toggle, and
 * this host's session read, which `academy-shell-header-client.tsx` wraps in the
 * thinnest possible client leaf (the config travels through it as data). The
 * header itself is mounted from the `@chrome` parallel-route slot (and the
 * footer from the root layout), which is why the package exports the two
 * independently rather than as one `<Shell>` wrapper.
 */
export async function AcademyShellHeader() {
  const t = await getTranslations("shell");

  return (
    <AcademyShellHeaderClient
      config={academyShellConfig(t)}
      loginLabel={t(portalNav.login.label)}
      profileLabel={t(portalNav.profile.label)}
    />
  );
}
