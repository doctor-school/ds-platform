"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link as DsLink } from "@ds/design-system";

const ITEMS = [
  {
    href: "/materials",
    labelKey: "materials.subnav.materials",
    testId: "subnav-materials",
  },
  {
    href: "/materials/sources",
    labelKey: "materials.subnav.sources",
    testId: "subnav-sources",
  },
] as const;

/**
 * The sub-navigation of the «Материалы» section (048 EARS-20, design §Admin:
 * «Источники» is reached from the section, no new chrome entry — EARS-23).
 * The whole section is a `platform_admin` route (`lib/admin-access.ts`), so a
 * principal without it never sees the section and therefore never this link.
 *
 * These are routes, not in-page panels, so they are links carrying
 * `aria-current="page"` rather than `Tabs` (whose semantics are a tab panel);
 * the current one takes the `neutral` page ink, the other the link colour.
 */
export function MaterialsSubnav() {
  const t = useTranslations();
  const pathname = usePathname();
  const current = pathname.startsWith("/materials/sources")
    ? "/materials/sources"
    : "/materials";

  return (
    <nav
      aria-label={t("materials.subnav.label")}
      className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-3 text-sm"
      data-testid="materials-subnav"
    >
      {ITEMS.map((item) => {
        const active = item.href === current;
        return (
          <DsLink
            key={item.href}
            asChild
            variant="standalone"
            tone={active ? "neutral" : "default"}
          >
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              data-testid={item.testId}
            >
              {t(item.labelKey)}
            </Link>
          </DsLink>
        );
      })}
    </nav>
  );
}
