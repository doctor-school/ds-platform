"use client";

import { Input } from "@ds/design-system/input";

import type { StorefrontShellConfig } from "./config";

/**
 * 017 EARS-5 — the header search band, split out of {@link StorefrontHeader}
 * purely to own a CLIENT boundary.
 *
 * Why it is its own module: the DS `Input` primitive is stateful (it tracks the
 * `data-filled` signal with `useState`) and, like every DS primitive, carries no
 * `"use client"` of its own — the directive is the CONSUMER's job (every other
 * consumer in the repo is already a client component). The header is a server
 * component: it reads the host config and renders the host's auth-cluster slot.
 * Rendering `Input` directly from it pulled the hook into the RSC graph and the
 * built storefront died on every route with
 * «TypeError: useState is not a function» (caught by the doctor Playwright tiers,
 * #2180). One thin client leaf keeps the header on the server and the primitive
 * on the client.
 *
 * The form is uncontrolled: `action` is the host's configured target and `q` the
 * query parameter the storefront feed already reads. This package never invents
 * a results surface (#1492).
 */
export function ShellSearch({
  search,
}: {
  search: NonNullable<StorefrontShellConfig["search"]>;
}) {
  return (
    <form
      data-testid="shell-search"
      role="search"
      action={search.action}
      className="order-last w-full min-w-0 layout:order-none layout:w-auto layout:flex-1 layout:basis-40"
    >
      <Input
        type="search"
        name="q"
        placeholder={search.placeholder}
        aria-label={search.placeholder}
        className="w-full border-header-hairline bg-transparent font-semibold text-header-foreground placeholder:text-header-foreground focus-visible:border-header-foreground"
      />
    </form>
  );
}
