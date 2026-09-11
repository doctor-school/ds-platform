import type { ReactNode } from "react";
import Image from "next/image";
import NextLink from "next/link";
import { Input } from "@ds/design-system/input";
import { Link as DsLink } from "@ds/design-system/link";

import type { ShellLink, StorefrontShellConfig } from "./config";
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
 * The auth cluster is a SLOT, not package state: «Войти / Регистрация» vs the
 * signed-in cluster is a host decision today (each storefront reads its own
 * session), and #2027 is what gives that read a shared home. The canvas points
 * plate (`map.doctor.user.points`) lives inside that slot and is Issue #1559 —
 * nothing here draws or reserves it.
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
  authCluster,
}: {
  config: StorefrontShellConfig;
  /** The host's auth affordances — rendered verbatim, or absent entirely. */
  authCluster?: ReactNode;
}) {
  const chrome = <HeaderChrome config={config} authCluster={authCluster} />;
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
  authCluster,
}: {
  config: StorefrontShellConfig;
  authCluster?: ReactNode;
}) {
  const { logo, topbar, search, nav } = config;
  return (
    <div data-host={config.host}>
      {/* The BBM announcement micro-band (canvas line 17) — brand decor on the
          deeper navy, directly above the chrome bar. */}
      <div className="bg-header-topbar px-4 py-1.5 text-center layout:px-12">
        {/* The testid sits on the TEXT LEAF, never on the band: the canvas ink
            is white at 34% on `blue.800` (ADR-0013 canvas-wins — raising it
            would be a lead-invented design change on a user-facing surface), so
            the e2e axe scan has to address this one text node and nothing
            around it. A container-scoped exclude would need an
            `axe-exclude-ok` marker; a leaf one does not. */}
        <span
          data-testid="shell-topbar"
          className="text-caption font-extrabold uppercase tracking-widest text-header-topbar-foreground"
        >
          {topbar.text}
        </span>
      </div>

      <header
        data-testid="storefront-header"
        className="flex flex-wrap items-center gap-4 bg-header px-4 py-3.5 text-header-foreground layout:flex-nowrap layout:px-12"
      >
        <DsLink asChild className="flex flex-none hover:no-underline">
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

        {search ? (
          /* ONE search element at every width: below `layout` it re-flows onto
             its own row (the canvas mobile search band), above it sits inline
             between the wordmark and the nav. `action` is the host's configured
             target — this package never invents a results surface (#1492). */
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
        ) : null}

        <nav
          data-testid="shell-nav-desktop"
          aria-label={config.footer.navTitle}
          className="ml-auto hidden items-center gap-7 text-sm layout:flex"
        >
          {nav.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        <div className="ml-auto flex flex-none items-center gap-3 layout:ml-0">
          <ThemeToggle />
          {authCluster ? (
            <div
              data-testid="shell-auth-cluster"
              className="flex items-center gap-3"
            >
              {authCluster}
            </div>
          ) : null}

          {/* 008 EARS-11 — below `layout` the nav collapses into the native `≡`
              disclosure, carrying the SAME configured targets. */}
          <details
            data-testid="shell-mobile-menu"
            className="relative layout:hidden"
          >
            <summary
              aria-label={config.footer.navTitle}
              className="inline-flex size-11 flex-none cursor-pointer list-none items-center justify-center bg-header-foreground text-xl font-extrabold text-header-chip-foreground shadow-header-chip focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true">≡</span>
            </summary>
            <nav
              data-testid="shell-nav-mobile"
              className="absolute right-0 top-full z-20 mt-2 flex min-w-52 flex-col border-2 border-border bg-card p-2 text-card-foreground shadow-btn"
            >
              {nav.map((item) => (
                <DsLink
                  key={item.href}
                  asChild
                  className="px-4 py-3 text-sm font-bold text-foreground hover:bg-muted hover:no-underline"
                >
                  <NextLink href={item.href}>{item.label}</NextLink>
                </DsLink>
              ))}
            </nav>
          </details>
        </div>
      </header>
    </div>
  );
}

/** Desktop nav link — the muted on-navy tier of the canvas, with the press step
 *  one VISIBLE step below the resting tier via ELEMENT opacity (#270), and the
 *  press colour re-anchored off the DS default (`primary-action` IS the band
 *  colour, so the base press painted the label invisible, #1007). */
function NavLink({ item }: { item: ShellLink }) {
  return (
    <DsLink
      asChild
      className="font-bold text-header-foreground no-underline opacity-80 active:text-header-foreground active:opacity-60"
    >
      <NextLink href={item.href}>{item.label}</NextLink>
    </DsLink>
  );
}
