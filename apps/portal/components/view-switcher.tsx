import Link from "next/link";
import { Button } from "@ds/design-system/button";

/**
 * 004 EARS-18 — the «Неделя / Месяц» view switcher shared by both discovery panes
 * (`webinars-listing.dc.html` / `webinars-month.dc.html`). The active side is a
 * non-interactive `aria-current` label on the filled `primary-action`; the other
 * side is a real link (never a dead CTA) that adopts the DS `Button` primitive's
 * `ghost` states (hover tint-fill / active / focus-visible ring) — the segmented
 * toggle affordance, never a hand-assembled one-off (004 owner verdict #2 on
 * #1052). Round-trip is loss-free: the month→week link carries the displayed month
 * so «Месяц» restores it (the caller composes the hrefs with the carried `month`
 * query param). No client state — pure query-param navigation, unauthenticated-safe.
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
        <Button
          asChild
          variant="ghost"
          className="justify-center px-4.5 py-2.5 text-caption text-tint-foreground"
        >
          <Link href={weekHref}>{weekLabel}</Link>
        </Button>
      )}

      {active === "month" ? (
        <span
          aria-current="page"
          className="inline-flex items-center justify-center border-l-2 border-border bg-primary-action px-4.5 py-2.5 text-caption font-extrabold text-primary-foreground"
        >
          {monthLabel}
        </span>
      ) : (
        <Button
          asChild
          variant="ghost"
          className="justify-center border-l-2 border-border px-4.5 py-2.5 text-caption text-tint-foreground"
        >
          <Link href={monthHref}>{monthLabel}</Link>
        </Button>
      )}
    </div>
  );
}
