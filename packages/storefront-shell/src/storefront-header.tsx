import Image from "next/image";
import NextLink from "next/link";
import { DisclosureSummary } from "@ds/design-system/disclosure-summary";
import { Link as DsLink } from "@ds/design-system/link";

import { ShellAuthCluster } from "./auth-cluster";
import type { ShellAuthState, StorefrontShellConfig } from "./config";
import { HeaderNavLink, MobileNavRow } from "./nav-link";
import { ShellSearch } from "./shell-search";
import { ThemeToggle } from "./theme-toggle";
import { VisibleOffPaths } from "./route-visibility";

/**
 * 008 EARS-1…5 / EARS-11 / EARS-13 · 017 EARS-1 / EARS-5 — the storefront
 * header, defined ONCE for BOTH storefronts (canvas `ds-shell.dc.html`,
 * ADR-0013 canvas-wins).
 *
 * Composition, top to bottom and left to right, per the canvas: the BBM
 * announcement micro-band → the navy chrome bar carrying the white wordmark, the
 * search (where the host has a results surface), the nav, the theme control and
 * the host's auth cluster, with the nav collapsing into the `≡` disclosure below
 * the `layout` breakpoint.
 *
 * It is a SERVER component. Everything host-specific arrives as a VALUE in
 * {@link StorefrontShellConfig} — no component here branches on `config.host`,
 * which is painted only as `data-host` for CSS and e2e selectors (008 EARS-13).
 *
 * The auth cluster is DATA, not a slot: the host resolves its own session and
 * passes the {@link ShellAuthState} in, and this package renders the chip
 * (`auth-cluster.tsx`). The ReactNode slot this replaced is what let the two
 * storefronts assemble two different chips out of one bar (#2180). #2027 is
 * what gives the session READ a shared home; the LOOK already has one.
 *
 * Exactly ONE search element and ONE auth cluster exist in the DOM at any width:
 * the canvas reaches its mobile layout by re-flowing the search onto its own row
 * (`flex-wrap` + `order-last`), never by rendering a hidden second copy — a
 * second cluster in the DOM is precisely what 017 EARS-1 forbids.
 *
 * Styling is tokens-only: the navy `header` band with `header-foreground` ink,
 * the deeper `header-topbar` band above it, the half-strength `header-hairline`
 * on the on-band controls, and the DS `Link` / `Button` / `Input` primitives for
 * every interactive element (AGENTS.md §6, ADR-0013).
 */
export function StorefrontHeader({
  config,
  auth,
}: {
  config: StorefrontShellConfig;
  /** The host's RESOLVED sign-in state — the package renders it. */
  auth: ShellAuthState;
}) {
  const chrome = <HeaderChrome config={config} auth={auth} />;
  return config.hiddenOnPaths ? (
    <VisibleOffPaths patterns={config.hiddenOnPaths}>{chrome}</VisibleOffPaths>
  ) : (
    chrome
  );
}

/** The chrome itself — the topbar band plus the navy bar, with no knowledge of
 *  whether a route boundary is wrapped around it. */
function HeaderChrome({
  config,
  auth,
}: {
  config: StorefrontShellConfig;
  auth: ShellAuthState;
}) {
  const { logo, topbar, search, nav } = config;
  // 008 EARS-5/11 — the signed-in session's own destinations (canvas
  // `user.links`, line 209). The canvas draws them INSIDE the nav group at both
  // widths: desktop after the nav items and BEFORE the theme control (line 33,
  // toggle line 35, chip line 36), mobile after the nav rows in the `≡` menu
  // (line 50). They are never a second cluster (017 EARS-1).
  const authLinks = auth.status === "doctor" ? (auth.links ?? []) : [];
  return (
    <div data-host={config.host}>
      {/* The BBM announcement micro-band (canvas line 17) — brand decor on the
          deeper navy, directly above the chrome bar. */}
      <div className="bg-header-topbar px-4 py-1.5 text-center text-topbar font-bold uppercase leading-none tracking-topbar layout:px-12">
        {/* The testid sits on the TEXT LEAF, never on the band: the canvas ink
            is white at 34% on `blue.800` (ADR-0013 canvas-wins — raising it
            would be a lead-invented design change on a user-facing surface), so
            the e2e axe scan has to address this one text node and nothing
            around it. A container-scoped exclude would need an
            `axe-exclude-ok` marker; a leaf one does not.
            Type is the canvas micro-band exactly — 9px / 700 / .22em uppercase
            (line 16), on the `topbar` size and tracking tokens — and it is
            declared ON THE BAND, as the canvas declares it. With the size on
            this span alone the band inherited the body's 24px line-height and
            the 9px text sat 15..26 in a 36px band — off-centre on BOTH hosts
            (#2198 Stage-B finding). `leading-none` on the band makes it
            5+9+5 = 19px of centred type. */}
        <span
          data-testid="shell-topbar"
          className="text-header-topbar-foreground"
        >
          {topbar.text}
        </span>
      </div>

      <header
        data-testid="storefront-header"
        className="flex flex-wrap items-center gap-4 bg-header px-4 py-3.5 text-header-foreground layout:flex-nowrap layout:px-12"
      >
        <DsLink asChild variant="wrapper" className="flex flex-none">
          <NextLink href={logo.href} data-testid="storefront-logo">
            <Image
              src="/brand/logo-white.svg"
              alt={logo.alt}
              width={500}
              height={164}
              priority
              unoptimized
              className="block h-6.5 w-auto"
            />
          </NextLink>
        </DsLink>

        {/* ONE search element at every width: below `layout` it re-flows onto
            its own row (the canvas mobile search band), above it sits inline
            between the wordmark and the nav. It lives in its own CLIENT leaf
            because the DS `Input` is stateful — see `shell-search.tsx`. */}
        {search ? <ShellSearch search={search} /> : null}

        <nav
          data-testid="shell-nav-desktop"
          aria-label={config.footer.navTitle}
          className="ml-auto hidden items-center gap-7 text-sm layout:flex"
        >
          {nav.map((item) => (
            <HeaderNavLink key={item.href} item={item} />
          ))}
          {/* …followed by the signed-in destinations, in the SAME nav group
              and the same link shape the canvas draws them in (line 33) — so
              the bar reads «Эфиры · Мои события · ☾ · Личный кабинет». The
              host with no `user.links` (the doctor storefront, canvas line 192)
              renders nothing here and its bar is unchanged. */}
          {authLinks.map((item) => (
            <HeaderNavLink
              key={item.href}
              item={item}
              testId="shell-auth-link"
            />
          ))}
        </nav>

        <div className="ml-auto flex flex-none items-center gap-3 layout:ml-0">
          <ThemeToggle />
          <ShellAuthCluster auth={auth} />

          {/* 008 EARS-11 — below `layout` the nav collapses into the native `≡`
              disclosure, carrying the SAME configured targets. */}
          <details
            data-testid="shell-mobile-menu"
            className="relative layout:hidden"
          >
            <DisclosureSummary aria-label={config.footer.navTitle}>
              <span aria-hidden="true">≡</span>
            </DisclosureSummary>
            <nav
              data-testid="shell-nav-mobile"
              className="absolute right-0 top-full z-20 mt-2 flex min-w-52 flex-col border-2 border-border bg-card p-2 text-card-foreground shadow-btn"
            >
              {nav.map((item) => (
                <MobileNavRow key={item.href} item={item} />
              ))}
              {/* …followed by the signed-in cluster's links (canvas line 50).
                  Rows, not a second cluster: 017 EARS-1 allows exactly ONE
                  `shell-auth-cluster` in the DOM at any width. */}
              {authLinks.map((item) => (
                <MobileNavRow
                  key={item.href}
                  item={item}
                  testId="shell-auth-link-mobile"
                />
              ))}
            </nav>
          </details>
        </div>
      </header>
    </div>
  );
}
