/**
 * `@ds/storefront-shell` — the storefront chrome, owned once for BOTH
 * storefronts (#2180, epic #2020 «one code, two storefronts»; ADR-0013 A1).
 *
 * The two components are exported separately rather than as one `<Shell>`
 * wrapper on purpose: the portal mounts the header from its `@chrome`
 * parallel-route slot and the footer from its root layout, so they must stay
 * independently mountable.
 *
 * The header's auth cluster is a SLOT (`authCluster`), not package state — each
 * storefront still reads its own session, and #2027 is what gives that read a
 * shared home. `@ds/storefront-shell/user-cluster` ships the signed-in cluster
 * a host can put in that slot; `@ds/storefront-shell/theme` ships the theme
 * store the package-owned toggle drives.
 */
export { StorefrontHeader } from "./storefront-header";
export { StorefrontFooter } from "./storefront-footer";
export { ThemeToggle, type ThemeToggleLabels } from "./theme-toggle";
export { isHiddenPath, matchesPathPattern } from "./config";
export type {
  ShellLink,
  StorefrontHostId,
  StorefrontShellConfig,
} from "./config";
