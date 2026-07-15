"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@ds/design-system/lib/utils";
import { Link as DsLink } from "@ds/design-system/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { useHeaderAuth } from "@/lib/header-auth";

/**
 * 008 EARS-1…6 / EARS-11 / EARS-13 — the persistent portal app-shell header,
 * built from the vendored «Doctor.School визуальный язык» canvas header block
 * (byte-identical across `webinars-listing.dc.html`, `my-events.dc.html`,
 * `profile.dc.html`, ADR-0013 canvas-wins). Mounted ONCE in the root layout so
 * the bar is present on every portal route by construction (EARS-1) and does not
 * remount across client navigations (the auth read in {@link useHeaderAuth} runs
 * once per hard load).
 *
 * Composition (canvas): a full-width `header`-token blue bar — the page's own blue
 * poster masthead stacks directly below it, forming one continuous blue band.
 *   • LEFT: the white wordmark logo, a link to `/` (EARS-2).
 *   • DESKTOP (≥ the `layout` breakpoint, the canvas ≤900px split): the top-nav
 *     [Эфиры → `/` · Мои события → `/account/events`] with the canvas active
 *     underline (EARS-2), the theme toggle (EARS-3), then the auth-state account
 *     affordance — «Войти» → `/login` for a guest (EARS-4) / the initials avatar
 *     icon → `/account` for a doctor (EARS-5/6, an icon, never a dropdown, no
 *     «Выйти»).
 *   • MOBILE (< `layout`): the nav collapses into a native `<details>` `≡`
 *     dropdown carrying the same [Эфиры · Мои события] (EARS-11); the theme toggle
 *     stays visible, and a doctor keeps the single-tap avatar icon beside `≡`
 *     (EARS-6 on mobile) while a guest gets «Войти» inside the dropdown.
 *
 * «Школы» is intentionally absent (EARS-10 _Retired_, owner 2026-07-15) — the v1
 * nav is exactly [Эфиры · Мои события], every target a shipped surface (EARS-2).
 *
 * The header renders NOTHING on the auth surfaces (`/login`, `/register`,
 * `/verify`, `/reset` — their own `AuthShell` chrome) and inside the webinar room
 * (`/webinars/:slug/room` — its own `room-header`), which carry their own headers
 * per the canvases.
 *
 * All copy comes from the `shell` message catalog (EARS-13) — no hardcoded
 * user-facing string. Every clickable composes the `@ds/design-system` `Link`
 * primitive (`<DsLink asChild>`) so hover / active / focus-visible states come
 * from the primitive, not a bespoke per-call stack (AGENTS.md §6, #818/#828); the
 * white-on-blue chips (Войти / avatar) override its brand-blue default off the
 * `header-*` palette + `shadow-btn` — no DS Button/Avatar variant targets an
 * inverted-on-blue control (they assume a light page bg; same precedent as the
 * shared {@link ThemeToggle}). registry-research (build-ui-from-design-system):
 * shadcn navigation-menu, Origin UI, Intent/Jolly, Kibo — none ship the branded
 * neo-brutalist inverted app bar; bespoke composition (see PR).
 */

/** Auth surfaces that own their `AuthShell` chrome — no app-shell header. */
const AUTH_ROUTES = new Set(["/login", "/register", "/verify", "/reset"]);
/** The webinar room owns its `room-header` chrome — no app-shell header. */
const ROOM_ROUTE = /^\/webinars\/[^/]+\/room$/;

/** The `/account` profile (feature 009) — the avatar affordance's one destination. */
const PROFILE_HREF = "/account";
/** The discovery front-door (EARS-2) — logo & «Эфиры». */
const DISCOVERY_HREF = "/";
/** «Мои события» (feature 005, EARS-2). */
const MY_EVENTS_HREF = "/account/events";
/** The login surface (EARS-4). */
const LOGIN_HREF = "/login";

/** A doctor with no saved display name still gets the avatar affordance — a
 *  neutral fallback glyph stands in for the initials (the icon still navigates to
 *  `/account`, where they can set a name). */
const AVATAR_FALLBACK_GLYPH = "•";

/** «Войти» chip — white-on-blue neo-brutalist button (canvas), token-only; states
 *  owned by the DS `Link` primitive it overrides. */
const LOGIN_CHIP =
  "inline-flex flex-none items-center justify-center bg-header-foreground px-6 py-3 text-sm font-bold text-header shadow-btn hover:no-underline hover:translate-x-px hover:translate-y-px hover:shadow-btn-hover";

/** Initials avatar icon — white-on-blue chip, an icon-LINK to `/account`
 *  (EARS-5/6: not a dropdown, no «Выйти»). */
const AVATAR_CHIP =
  "inline-flex size-10 flex-none items-center justify-center bg-header-foreground text-sm font-extrabold text-header shadow-btn hover:no-underline";

export function AppShellHeader() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const auth = useHeaderAuth();

  // Hooks above run unconditionally (rules of hooks); THEN decide visibility.
  if (AUTH_ROUTES.has(pathname) || ROOM_ROUTE.test(pathname)) return null;

  const isActive = (href: string) => pathname === href;

  const avatarLink = (testId: string) => (
    <DsLink asChild className={AVATAR_CHIP}>
      <Link href={PROFILE_HREF} aria-label={t("profile")} data-testid={testId}>
        {auth.status === "doctor" && auth.initials
          ? auth.initials
          : AVATAR_FALLBACK_GLYPH}
      </Link>
    </DsLink>
  );

  return (
    <header className="flex items-center justify-between gap-4 bg-header px-4 py-4 text-header-foreground layout:px-12">
      {/* Logo → the discovery front-door (EARS-2). The clean white vector sits
          directly on the blue bar — no chip, no colour inversion (ADR-0013 §8;
          the same asset the AuthShell panel uses). */}
      <DsLink asChild className="flex flex-none hover:no-underline">
        <Link href={DISCOVERY_HREF} data-testid="shell-logo">
          <Image
            src="/brand/logo-white.svg"
            alt={t("logoAlt")}
            width={500}
            height={164}
            priority
            unoptimized
            className="block h-7 w-auto"
          />
        </Link>
      </DsLink>

      {/* ── Desktop nav (≥ layout) ── */}
      <nav
        className="hidden items-center gap-7 text-sm layout:flex"
        data-testid="shell-nav-desktop"
      >
        <NavLink
          href={DISCOVERY_HREF}
          active={isActive(DISCOVERY_HREF)}
          testId="shell-nav-broadcasts"
        >
          {t("navBroadcasts")}
        </NavLink>
        <NavLink
          href={MY_EVENTS_HREF}
          active={isActive(MY_EVENTS_HREF)}
          testId="shell-nav-my-events"
        >
          {t("navMyEvents")}
        </NavLink>
        <ThemeToggle label={t("themeToggle")} />
        {/* Account affordance — reserve the box while the session read resolves
            (no first-paint flash / layout shift), then branch (EARS-4/5). */}
        {auth.status === "loading" ? (
          <span className="inline-flex size-10 flex-none" aria-hidden />
        ) : auth.status === "guest" ? (
          <DsLink asChild className={LOGIN_CHIP}>
            <Link href={LOGIN_HREF} data-testid="shell-login">
              {t("login")}
            </Link>
          </DsLink>
        ) : (
          avatarLink("shell-avatar")
        )}
      </nav>

      {/* ── Mobile controls (< layout) ── */}
      <div className="flex items-center gap-3 layout:hidden">
        <ThemeToggle label={t("themeToggle")} />
        {/* A doctor keeps the single-tap avatar icon beside `≡` (EARS-6 on
            mobile); a guest's way-in («Войти») lives inside the dropdown. */}
        {auth.status === "doctor" ? avatarLink("shell-mobile-avatar") : null}
        <details className="relative" data-testid="shell-mobile-menu">
          {/* The native `≡` disclosure — a `<summary>` (not a DS clickable
              primitive); its own focus ring uses the DS `shadow-focus` token. */}
          <summary
            aria-label={t("menu")}
            className="inline-flex size-11 flex-none cursor-pointer list-none items-center justify-center bg-header-foreground text-xl font-extrabold text-header shadow-btn focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden"
          >
            <span aria-hidden="true">≡</span>
          </summary>
          <nav className="absolute right-0 top-full z-20 mt-2 flex min-w-52 flex-col border-2 border-border bg-card p-2 text-card-foreground shadow-btn">
            <MobileNavLink
              href={DISCOVERY_HREF}
              active={isActive(DISCOVERY_HREF)}
              testId="shell-mobile-broadcasts"
            >
              {t("navBroadcasts")}
            </MobileNavLink>
            <MobileNavLink
              href={MY_EVENTS_HREF}
              active={isActive(MY_EVENTS_HREF)}
              testId="shell-mobile-my-events"
            >
              {t("navMyEvents")}
            </MobileNavLink>
            {auth.status === "guest" ? (
              <DsLink
                asChild
                className="mt-1.5 bg-header px-4 py-3 text-center text-sm font-extrabold text-header-foreground hover:no-underline"
              >
                <Link href={LOGIN_HREF} data-testid="shell-mobile-login">
                  {t("login")}
                </Link>
              </DsLink>
            ) : null}
          </nav>
        </details>
      </div>
    </header>
  );
}

/** Desktop nav link — canvas active treatment (resting underline, full-strength)
 *  vs the muted inactive tier (element opacity, AA-safe — never a text-colour
 *  opacity, #270). States are owned by the composed DS `Link` primitive. */
function NavLink({
  href,
  active,
  testId,
  children,
}: {
  href: string;
  active: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <DsLink
      asChild
      className={cn(
        "font-bold text-header-foreground",
        active ? "underline decoration-2" : "no-underline opacity-80",
      )}
    >
      <Link
        href={href}
        data-testid={testId}
        aria-current={active ? "page" : undefined}
      >
        {children}
      </Link>
    </DsLink>
  );
}

/** Mobile dropdown nav link — on the card surface, active reads as brand-blue
 *  heavy text (canvas dropdown), inactive as ink with a muted hover wash. */
function MobileNavLink({
  href,
  active,
  testId,
  children,
}: {
  href: string;
  active: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <DsLink
      asChild
      className={cn(
        "px-4 py-3 text-sm hover:bg-muted hover:no-underline",
        active ? "font-extrabold text-header" : "font-bold text-foreground",
      )}
    >
      <Link
        href={href}
        data-testid={testId}
        aria-current={active ? "page" : undefined}
      >
        {children}
      </Link>
    </DsLink>
  );
}
