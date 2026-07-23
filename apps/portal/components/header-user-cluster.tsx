"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { cn } from "@ds/design-system/lib/utils";
import { Link as DsLink } from "@ds/design-system/link";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The user cluster shared by BOTH portal chrome bars — the persistent app-shell
 * header (008) and the webinar-room header (006). It is the same two-button unit
 * everywhere (owner directive 2026-07-23): the theme toggle followed by the
 * doctor's profile chip, toggle LEFT, chip RIGHTMOST. Extracting it to ONE
 * component (not just a shared class) makes the presentation a single source of
 * truth — a chip restyle or a re-order lands in both bars at once — while each
 * call site parameterizes only what genuinely differs (the initials, the chip's
 * responsive visibility, the surrounding gap), never the look.
 *
 * The chip is the canvas white-on-blue neo-brutalist chip (`background:#fff`,
 * navy `#114D9E` ink in BOTH themes — `header-chip-foreground`), an icon-LINK to
 * `/account` (EARS-5/6: never a dropdown, no «Выйти»). Its offset shadow casts in
 * `shadow-header-chip` — the theme-INVARIANT dark ink offset (`header-chip-shadow`
 * = neutral.900 both themes), NOT the generic `shadow-btn`, whose `border` cast
 * flips to WHITE in dark and rendered the chip a white square with a white shadow
 * on the navy band (#1145). Interaction chain mirrors the DS Button neo-brutalist
 * press: rest → hover sinks 1px (`shadow-header-chip-hover`) → press sinks 2px and
 * drops the shadow, ink pinned full-strength on press (the primitive's press tint
 * goes near-white on the white chip in dark).
 */

/** The white-on-header neo-brutalist chip base — shared by the avatar chip here
 *  and the shell's «Войти» chip / mobile ≡ (one source of truth for the
 *  dark-safe `shadow-header-chip` cast, #1145). Size/padding/weight compose on
 *  top per chip. */
export const HEADER_CHIP_BASE =
  "inline-flex flex-none items-center justify-center bg-header-foreground text-header-chip-foreground shadow-header-chip hover:no-underline hover:translate-x-px hover:translate-y-px hover:shadow-header-chip-hover active:translate-x-0.5 active:translate-y-0.5 active:shadow-none active:text-header-chip-foreground";

/** The initials-avatar chip — the base at the canvas 40px square. */
const AVATAR_CHIP = cn(HEADER_CHIP_BASE, "size-10 text-sm font-extrabold");

/** A doctor with no saved display name gets a neutral silhouette icon (#997) —
 *  the link still navigates to `/account`, where they can set a name. */
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
  href?: string;
  testId: string;
  /** Per-call-site extras — e.g. the room's desktop-only `hidden layout:inline-flex`. */
  className?: string;
}) {
  return (
    <DsLink asChild className={cn(AVATAR_CHIP, className)}>
      <Link href={href} aria-label={label} data-testid={testId}>
        {initials ? initials : avatarFallbackIcon}
      </Link>
    </DsLink>
  );
}

/** The theme-toggle + profile-chip pair — the same two-button unit in both
 *  chrome bars (toggle left, chip rightmost). */
export function HeaderUserCluster({
  themeToggleLabel,
  profileLabel,
  initials,
  profileHref,
  profileTestId,
  className,
  profileClassName,
}: {
  themeToggleLabel: string;
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
      <ThemeToggle label={themeToggleLabel} />
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
