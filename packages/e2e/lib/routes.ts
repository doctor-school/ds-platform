/**
 * ROUTE-MANIFEST FILTERING for the derived route walk — staging/regression-contour
 * tech spec §6.3, second bullet (Issue #2067).
 *
 * The slot's image publishes its Next `app-paths-manifest.json` at
 * `MANIFEST_PATH` (`hosts.ts`). That file is a map of INTERNAL app-router keys
 * (`/(storefront)/documents/[slug]/page`) to the bundled module that serves them
 * — not a list of addresses. This module turns one into the other, and it is the
 * only place that knows the difference, so the walk itself contains no route
 * knowledge at all.
 *
 * Pure on purpose: everything here is a string transform over a parsed manifest,
 * which is what makes it a Vitest unit (`routes.test.ts`) rather than something
 * only a raised slot can check.
 */

/** The manifest as Next writes it: app-router key → bundled module path. */
export type AppPathsManifest = Readonly<Record<string, string>>;

/**
 * Keys the walk never visits, by the fixed pattern §6.3 calls for:
 *
 *   • `…/route`  — a Route Handler. It answers a method contract, not a page;
 *     asserting «200 + an `h1`» on it would be asserting the wrong thing.
 *   • `/api/**`  — the same, by address, for handlers mounted under `/api`.
 *   • `/_not-found`, `/_global-error`, `/_next/**` — Next's own internals.
 *     `/_not-found` renders by definition only for addresses that do not exist;
 *     `/_global-error` only for a thrown root error, so opening it directly is a
 *     500 by design (App Router lists it in the manifest since Next 15).
 *   • a `@slot` segment — a PARALLEL route (`/@chrome/[...catchAll]`). It is not
 *     an address: it is a slot the layout composes into another page, and
 *     fetching it directly proves nothing about what the visitor sees.
 *   • a `(.)`, `(..)`, `(..)(..)` or `(...)` segment — an INTERCEPTING route. It
 *     only exists on a client-side navigation from the intercepting context.
 */
function isSkippedKey(key: string): boolean {
  if (!key.endsWith("/page")) return true; // `…/route` and anything else
  const segments = key.split("/").filter(Boolean);
  return segments.some(
    (segment) =>
      segment.startsWith("@") ||
      segment === "api" ||
      segment === "_not-found" ||
      segment === "_global-error" ||
      segment === "_next" ||
      /^\((?:\.{1,3}|\.{2}\)\(\.{2})\)/.test(segment),
  );
}

/** A ROUTE GROUP — `(storefront)` — organises files, never the URL. */
function isRouteGroup(segment: string): boolean {
  return (
    segment.startsWith("(") &&
    segment.endsWith(")") &&
    !segment.startsWith("(.")
  );
}

/** Turn one manifest key into the address pattern a visitor can type. */
function addressOf(key: string): string {
  const segments = key
    .slice(0, -"/page".length)
    .split("/")
    .filter(Boolean)
    .filter((segment) => !isRouteGroup(segment));
  return `/${segments.join("/")}`.replace(/\/{2,}/g, "/");
}

/** Does this address still carry a `[param]` that needs a golden value? */
export function isDynamic(pattern: string): boolean {
  return /\[[^\]]+\]/.test(pattern);
}

/**
 * Every address pattern the walk must visit, deduplicated and in stable order.
 *
 * Deduplication is load-bearing rather than cosmetic: two route groups can
 * resolve to ONE address (`/(room)/events/[slug]/room` and a storefront sibling),
 * and a duplicate would report the same route twice — one pass and one failure
 * for the same page, which is worse than either.
 */
export function pageRoutesFrom(manifest: AppPathsManifest): string[] {
  const addresses = new Set<string>();
  for (const key of Object.keys(manifest)) {
    if (isSkippedKey(key)) continue;
    addresses.add(addressOf(key));
  }
  return [...addresses].sort();
}
