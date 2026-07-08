"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Link as DsLink } from "@ds/design-system";

/**
 * Back-to-list affordance (#664) — the one-click return from every inner admin
 * screen (create / edit) to the events list, so the operator is never stuck in a
 * navigation dead-end (Stage-B feedback on #660). Adopts the owned
 * `@ds/design-system` `Link` primitive (standalone variant — brand `text-primary-action`
 * blue.700, hover-underline, focus ring, no arbitrary Tailwind value) wrapping
 * `next/link` via `asChild`; copy comes from the RU catalog (007 EARS-10), styling
 * is token-only (EARS-11). Rendered above the page title on each inner surface.
 */
export function BackToList() {
  const t = useTranslations();
  return (
    <DsLink asChild variant="standalone" className="text-sm">
      <Link href="/events" data-testid="back-to-list">
        {t("events.backToList")}
      </Link>
    </DsLink>
  );
}
