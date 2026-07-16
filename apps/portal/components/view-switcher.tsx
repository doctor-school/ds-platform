import Link from "next/link";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * 004 EARS-18 — the «Неделя / Месяц» view switcher shared by both discovery panes
 * (`webinars-listing.dc.html` / `webinars-month.dc.html`). The active side is a
 * non-interactive `aria-current` label on the filled `primary-action`; the other
 * side is a real link (never a dead CTA) built from the DS `Link` primitive (so it
 * carries hover / focus-visible states). Round-trip is loss-free: the month→week
 * link carries the displayed month so «Месяц» restores it (the caller composes the
 * hrefs with the carried `month` query param). No client state — pure query-param
 * navigation, unauthenticated-safe.
 */
export interface ViewSwitcherProps {
  active: "week" | "month";
  weekHref: string;
  monthHref: string;
  weekLabel: string;
  monthLabel: string;
}

export function ViewSwitcher({
  active,
  weekHref,
  monthHref,
  weekLabel,
  monthLabel,
}: ViewSwitcherProps) {
  return (
    <div
      className="inline-grid grid-cols-2 border-2 border-border bg-card shadow-sm"
      data-testid="view-switcher"
    >
      {active === "week" ? (
        <span
          aria-current="page"
          className="inline-flex items-center justify-center bg-primary-action px-4.5 py-2.5 text-caption font-extrabold text-primary-foreground"
        >
          {weekLabel}
        </span>
      ) : (
        <DsLink
          asChild
          className="inline-flex items-center justify-center px-4.5 py-2.5 text-caption font-bold text-tint-foreground"
        >
          <Link href={weekHref}>{weekLabel}</Link>
        </DsLink>
      )}

      {active === "month" ? (
        <span
          aria-current="page"
          className="inline-flex items-center justify-center border-l-2 border-border bg-primary-action px-4.5 py-2.5 text-caption font-extrabold text-primary-foreground"
        >
          {monthLabel}
        </span>
      ) : (
        <DsLink
          asChild
          className="inline-flex items-center justify-center border-l-2 border-border px-4.5 py-2.5 text-caption font-bold text-tint-foreground"
        >
          <Link href={monthHref}>{monthLabel}</Link>
        </DsLink>
      )}
    </div>
  );
}
