"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@ds/design-system/lib/utils";
import { Link as DsLink } from "@ds/design-system/link";
import { HEADER_CHIP_BASE } from "@ds/design-system";
import { HeaderProfileChip } from "@ds/storefront-shell/user-cluster";

import { useHeaderAuth } from "@/lib/header-auth";
import { LOGIN_HREF, PROFILE_HREF } from "@/lib/shell-config";

/**
 * 008 EARS-4/5/6 — the academy storefront's auth affordance, the host filler of
 * the shared chrome's `authCluster` slot (`@ds/storefront-shell`, #2180).
 *
 * The slot is a host decision because each storefront still reads its own
 * session — this one from the client ({@link useHeaderAuth} → the shipped
 * self-profile read), the doctor storefront from the request headers on the
 * server. #2027 is what gives that read a shared home; until then the SHAPE is
 * shared (one cluster, at every width) and only the read differs.
 *
 * Three states, one box: `loading` reserves the affordance's size so the bar
 * neither flashes the wrong branch nor shifts; `guest` gets the «Войти» chip;
 * a signed-in doctor gets the initials avatar icon-LINK to `/account` (EARS-5/6
 * — an icon, never a dropdown, no «Выйти»). The chip is the package's
 * {@link HeaderProfileChip}, the same presentation the webinar room mounts.
 *
 * The THEME TOGGLE is not here: the shared header owns it and renders it
 * immediately before this slot, so the canvas two-button unit (toggle left,
 * chip rightmost) comes out of the composition rather than out of a per-host
 * re-assembly. All copy is read from the `shell` catalog (EARS-13).
 */

/** «Войти» chip — the white-on-blue neo-brutalist button of the canvas, on the
 *  design system's shared {@link HEADER_CHIP_BASE} so the dark-safe
 *  `shadow-header-chip` cast is one source of truth with the avatar chip
 *  (#1145). Ink is `header-chip-foreground` — the canvas navy in BOTH themes,
 *  8.14:1 on white; `primary-action` lifts to a light blue in dark and would
 *  fail on the white chip (#1007 / #1085). */
const LOGIN_CHIP = cn(HEADER_CHIP_BASE, "px-6 py-3 text-sm font-bold");

export function AcademyAuthCluster() {
  const t = useTranslations("shell");
  const auth = useHeaderAuth();

  if (auth.status === "loading") {
    return <span className="inline-flex size-10 flex-none" aria-hidden />;
  }

  if (auth.status === "guest") {
    return (
      <DsLink asChild className={LOGIN_CHIP}>
        <Link href={LOGIN_HREF} data-testid="shell-login">
          {t("login")}
        </Link>
      </DsLink>
    );
  }

  return (
    <HeaderProfileChip
      label={t("profile")}
      initials={auth.initials}
      href={PROFILE_HREF}
      testId="shell-avatar"
    />
  );
}
