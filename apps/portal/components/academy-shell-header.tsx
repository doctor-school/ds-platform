import { getTranslations } from "next-intl/server";
import { StorefrontHeader } from "@ds/storefront-shell";

import { AcademyAuthCluster } from "@/components/academy-auth-cluster";
import { academyShellConfig } from "@/lib/shell-config";

/**
 * 008 EARS-1 — the academy storefront's header mount, the single place the
 * shared chrome (`@ds/storefront-shell`, #2180) meets this host's values and its
 * auth slot.
 *
 * It stays a SERVER component: the catalog is read with `getTranslations`, so
 * the chrome's copy is resolved on the server and only the two genuinely
 * interactive parts — the package's theme toggle and this host's auth cluster —
 * cross into the client bundle. The header itself is mounted from the `@chrome`
 * parallel-route slot (and the footer from the root layout), which is why the
 * package exports the two independently rather than as one `<Shell>` wrapper.
 */
export async function AcademyShellHeader() {
  const t = await getTranslations("shell");

  return (
    <StorefrontHeader
      config={academyShellConfig(t)}
      authCluster={<AcademyAuthCluster />}
    />
  );
}
