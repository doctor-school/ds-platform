"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { cn } from "@ds/design-system/lib/utils";
import { Link as DsLink } from "@ds/design-system/link";
import { buttonVariants } from "@ds/design-system/button";

import { ThemeToggle, type ThemeToggleLabels } from "./theme-toggle";

/**
 * The user cluster shared by every DS chrome bar — the storefront header and the
 * webinar-room header (006). It is the same two-button unit everywhere (owner
 * directive 2026-07-23): the theme toggle followed by the doctor's profile chip,
 * toggle LEFT, chip RIGHTMOST. Keeping it ONE component (not just a shared
 * class) makes the presentation a single source of truth — a chip restyle or a
 * re-order lands in every bar at once — while each call site parameterizes only
 * what genuinely differs (the initials, the chip's responsive visibility, the
 * surrounding gap), never the look.
 *
 * Moved here from `apps/portal/components/header-user-cluster.tsx` in #2180,
 * behaviour unchanged, so BOTH storefronts compose the identical unit instead of
 * one owning it and the other re-deriving it (ADR-0013 A1). It is a SECONDARY
 * entry point (`@ds/storefront-shell/user-cluster`): a surface that needs the
 * cluster or the bare chip WITHOUT the shell — the webinar room — imports it
 * directly, and the auth-state logic that decides WHICH cluster to show stays
 * with the host until #2027 gives it a home.
 *
 * The chip is the canvas white-on-blue neo-brutalist chip, here as an icon-LINK
 * to the profile (008 EARS-5/6: never a dropdown, no «Выйти»). Its presentation
 * is NOT declared here and there is no chip class string in this package: it is
 * the design system's `on-primary` Button at its `avatar` size — the ONE header
 * chip definition both storefronts and the webinar room compose from (#2180).
 * A second class-string constant beside it is exactly what let the two
 * storefronts' chips drift apart. The #1145 dark-shadow lesson is recorded on
 * that definition.
 */

/** The initials-avatar chip — the one header-chip definition at the canvas 40px
 *  square (`buttonVariants`, never a local copy of its classes). */
const AVATAR_CHIP = buttonVariants({ variant: "on-primary", size: "avatar" });

/** A doctor with no saved display name gets a neutral silhouette icon (#997) —
 *  the link still navigates to the profile, where they can set a name. */
const avatarFallbackIcon = <UserRound aria-hidden="true" className="size-5" />;

/** The profile chip on its own — the initials-or-silhouette icon-link to the
 *  profile. Exported so a surface that needs the chip WITHOUT the toggle can
 *  reuse the identical presentation. */
export function HeaderProfileChip({
  label,
  initials,
  href = "/account",
  testId,
  className,
}: {
  /** The link's accessible name (the catalog `profile` / `avatarLabel`). */
  label: string;
  /** The doctor's initials; `null` → the neutral silhouette fallback (#997). */
  initials: string | null;
  /** The profile destination (defaults to `/account`). */
  href?: string | undefined;
  testId: string;
  /** Per-call-site extras — e.g. the room's desktop-only `hidden layout:inline-flex`. */
  className?: string | undefined;
}) {
  return (
    <DsLink asChild className={cn(AVATAR_CHIP, className)}>
      <Link href={href} aria-label={label} data-testid={testId}>
        {initials ? initials : avatarFallbackIcon}
      </Link>
    </DsLink>
  );
}

/** The theme-toggle + profile-chip pair — the same two-button unit in every
 *  chrome bar (toggle left, chip rightmost). */
export function HeaderUserCluster({
  themeToggleLabels,
  profileLabel,
  initials,
  profileHref,
  profileTestId,
  className,
  profileClassName,
}: {
  /** Accessible names of the toggle; omitted → the package's RU defaults. */
  themeToggleLabels?: ThemeToggleLabels;
  profileLabel: string;
  initials: string | null;
  profileHref?: string;
  profileTestId: string;
  /** The flex wrapper's gap/order — differs per bar (shell nav rhythm vs the
   *  room's right-group order-first re-seat on mobile). */
  className?: string;
  /** Forwarded to the chip — e.g. the room's desktop-only visibility. */
  profileClassName?: string;
}) {
  return (
    <div className={cn("flex items-center", className)}>
      <ThemeToggle labels={themeToggleLabels} />
      <HeaderProfileChip
        label={profileLabel}
        initials={initials}
        href={profileHref}
        testId={profileTestId}
        className={profileClassName}
      />
    </div>
  );
}
