"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserRound } from "lucide-react";
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
 * once on mount and re-runs on the `refreshHeaderAuth()` signal the auth flows
 * fire after a successful login — the avatar appears on the soft post-login
 * landing without a hard reload, #1004).
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
 * shared {@link ThemeToggle}). The primitive's press colour
 * (`active:text-primary-action/80`) is likewise re-anchored per surface: on the
 * blue band `primary-action` (blue.700) IS the band colour, so a press painted
 * the label invisible for the whole click-through (#1007 Stage-B round 1).
 * Owner design rule (Stage-B 2026-07-16, round 2): EVERY interactive state is
 * one VISIBLE step down from the state it transitions from (rest → hover →
 * press), per occurrence. On-blue links press via an element-opacity step
 * below their own resting tier (#270: element opacity, never a
 * foreground-colour opacity); white chips follow the DS Button neo-brutalist
 * press (`button.tsx` base: sink deeper than hover + drop the shadow) with the
 * ink pinned to full-strength `header-chip-foreground` — the canvas navy
 * #114D9E in BOTH themes (kills the primitive's press tint, which goes
 * near-white on the white chip in dark theme; a distinct token from `header`,
 * which is the band-BACKGROUND role — itself navy blue.700 in both themes since
 * owner verdict #4, #1085 — and from `primary-action`, which lifts to a light
 * blue in dark). registry-research (build-ui-from-design-system):
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
 *  neutral user-silhouette icon (lucide `UserRound`, aria-hidden; the accessible
 *  name stays the catalog `profile` label on the link) stands in for the
 *  initials (#997). The icon-link still navigates to `/account`, where they can
 *  set a name. */
const avatarFallbackIcon = <UserRound aria-hidden="true" className="size-5" />;

/** «Войти» chip — white-on-blue neo-brutalist button (canvas), token-only.
 *  Chain: rest (shadow-btn) → hover (sink 1px, shadow-btn-hover) → press (sink
 *  2px, shadow-none — the DS Button press language scaled to the chip's 1px
 *  hover). Ink = `header-chip-foreground` (the canvas navy #114D9E in BOTH
 *  themes, 8.14:1 on white — a distinct token from `header` (the band bg role)
 *  and `primary-action` (which lifts to a light blue in dark and would fail on
 *  the white chip)), pinned full-strength on press. */
const LOGIN_CHIP =
  "inline-flex flex-none items-center justify-center bg-header-foreground px-6 py-3 text-sm font-bold text-header-chip-foreground shadow-btn hover:no-underline hover:translate-x-px hover:translate-y-px hover:shadow-btn-hover active:translate-x-0.5 active:translate-y-0.5 active:shadow-none active:text-header-chip-foreground";

/** Initials avatar icon — white-on-blue chip, an icon-LINK to `/account`
 *  (EARS-5/6: not a dropdown, no «Выйти»). Same chip chain + navy ink as
 *  «Войти»: rest → hover sinks 1px with shadow-btn-hover → press sinks 2px and
 *  drops the shadow (Stage-B round 2: the chip previously had NO visible hover
 *  delta). */
const AVATAR_CHIP =
  "inline-flex size-10 flex-none items-center justify-center bg-header-foreground text-sm font-extrabold text-header-chip-foreground shadow-btn hover:no-underline hover:translate-x-px hover:translate-y-px hover:shadow-btn-hover active:translate-x-0.5 active:translate-y-0.5 active:shadow-none active:text-header-chip-foreground";

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
          : avatarFallbackIcon}
      </Link>
    </DsLink>
  );

  return (
    <header className="flex items-center justify-between gap-4 bg-header px-4 py-4 text-header-foreground layout:px-12">
      {/* Logo → the discovery front-door (EARS-2). The clean white vector sits
          directly on the blue bar — no chip, no colour inversion (ADR-0013 §8;
          the same asset the AuthShell panel uses). No press-colour override
          needed: the link paints only an <img>, text colour is a no-op (#1007). */}
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
            className="inline-flex size-11 flex-none cursor-pointer list-none items-center justify-center bg-header-foreground text-xl font-extrabold text-header-chip-foreground shadow-btn focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden"
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
              /* Blue chip on the card: rest 100 → hover 90 → press 80 — one
                 visible element-opacity step per state (owner rule, Stage-B
                 round 2); ink pinned to header-foreground (round 1: the base
                 press tint = the chip's own bg). */
              <DsLink
                asChild
                className="mt-1.5 bg-header px-4 py-3 text-center text-sm font-extrabold text-header-foreground hover:no-underline hover:opacity-90 active:text-header-foreground active:opacity-80"
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
 *  opacity, #270). Sized at the pre-#1083 `font-bold` (700) inheriting the nav
 *  container's `text-sm` (14px) — owner verdict #4 (#1052 → #1085) put the light
 *  `header` band on navy blue.700 (#114D9E, white 8.14:1 full AA), so the nav no
 *  longer needs the WCAG large-text carve-out and returns to its original size
 *  (the `text-xl` large-text route of #1083 was rejected, «огромные пункты
 *  меню»); on navy the inactive `opacity-80` tier composites to ≥6:1, the
 *  historical AA-clean state. States are owned by the composed DS `Link`
 *  primitive, except
 *  the press colour: the base `active:text-primary-action/80` is blue.700 = the
 *  `header` band itself, so pressing painted the label invisible for the whole
 *  click-through (#1007 Stage-B round 1) — re-anchored to full-strength
 *  `header-foreground` + a PER-BRANCH element-opacity step (#270): press = one
 *  visible step down from the tier it transitions from (owner rule, Stage-B
 *  round 2) — the inactive branch rests at 80 so presses to 60; the
 *  route-active branch rests at 100 so presses to 80. */
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
        "font-bold text-header-foreground active:text-header-foreground",
        active
          ? "underline decoration-2 active:opacity-80"
          : "no-underline opacity-80 active:opacity-60",
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
 *  heavy text (canvas dropdown), inactive as ink with a muted hover wash. The DS
 *  base press colour (`active:text-primary-action/80`) stays: on the card
 *  surface it is readable in both themes — only the on-blue compositions above
 *  needed re-anchoring (#1007 Stage-B). */
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
