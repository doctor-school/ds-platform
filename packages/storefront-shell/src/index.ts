/**
 * `@ds/storefront-shell` — the storefront chrome, owned once for BOTH
 * storefronts (#2180, epic #2020 «one code, two storefronts»; ADR-0013 A1).
 *
 * The two components are exported separately rather than as one `<Shell>`
 * wrapper on purpose: the portal mounts the header from its `@chrome`
 * parallel-route slot and the footer from its root layout, so they must stay
 * independently mountable.
 *
 * The header's auth cluster is PACKAGE-owned and driven by data: a host passes
 * the resolved {@link ShellAuthState} and the package renders the chip (#2180).
 * Where the session is read stays a host decision — #2027 is what gives that
 * read a shared home — but the look is not a host decision any more, which is
 * what stops the two storefronts' chips drifting apart.
 * `@ds/storefront-shell/user-cluster` ships the signed-in cluster for a surface
 * that mounts the chip WITHOUT the shell (the webinar room);
 * `@ds/storefront-shell/theme` ships the theme store the package-owned toggle
 * drives.
 */
export { StorefrontHeader } from "./storefront-header";
export { StorefrontFooter } from "./storefront-footer";
export { ThemeToggle, type ThemeToggleLabels } from "./theme-toggle";
export { isHiddenPath, matchesPathPattern } from "./config";
export { ShellAuthCluster } from "./auth-cluster";
export { refreshShellAuth, useShellAuth } from "./shell-auth-refresh";
export type {
  ShellAuthState,
  ShellLink,
  StorefrontHostId,
  StorefrontShellConfig,
} from "./config";
