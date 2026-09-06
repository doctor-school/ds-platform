import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `EventPageShell` / `EventPageHero` (020 EARS-1, #1764) — the ONE event-page
 * composition both storefronts mount (LD-1): the doctor storefront and the
 * Academy each supply copy, breadcrumb and routes, and neither owns a layout of
 * its own. Built from the vendored variant-А canvas
 * `design-source/webinar-page-variant-a.dc.html` (owner pick recorded
 * 2026-09-02): the navy poster band, the `-80px` overlap that lifts the right
 * column into it, and the `1fr 360px` desktop grid that collapses to one column
 * with the sign-up card FIRST at ≤900px (`layout` breakpoint = 901px).
 *
 * The blocks carry no RU copy beyond the canvas-fixed section labels — every
 * string a host could phrase differently arrives as a prop, so the two
 * storefronts stay one implementation rather than two forks.
 */

export interface EventPageHeroProps {
  /**
   * Host-owned breadcrumb trail — the block renders the row, never the hrefs.
   * The poster band is the theme-INVARIANT navy surface, so links inside it must
   * be `<Link tone="on-primary">`: the default `primary-action` tone flips to
   * light blue in dark and falls under AA against the navy (axe `color-contrast`).
   */
  breadcrumb?: React.ReactNode;
  /** «Школа ортобиологии · Вебинар · Онлайн» — school · kind · format. */
  kicker: React.ReactNode;
  title: React.ReactNode;
  /** «28 августа, 19:00 (МСК) · 90 минут». */
  dateLine: React.ReactNode;
  /** Specialty chips and the НМО chip — flat labels, host-ordered. */
  chips?: readonly React.ReactNode[];
  /** The lifecycle plate («Скоро · через 5 дней», «В эфире», «Запись») as a slot. */
  statusPlate?: React.ReactNode;
  className?: string;
}

export function EventPageHero({
  breadcrumb,
  kicker,
  title,
  dateLine,
  chips,
  statusPlate,
  className,
}: EventPageHeroProps) {
  return (
    <div
      data-testid="event-page-hero"
      className={cn("bg-hero px-4 pb-32 pt-6 layout:px-gutter layout:pt-9", className)}
    >
      <div className="mx-auto max-w-content">
        {breadcrumb ? (
          <nav
            data-testid="event-page-hero-breadcrumb"
            className="mb-7 flex flex-wrap items-center gap-2 text-caption font-bold text-hero-muted"
          >
            {breadcrumb}
          </nav>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-8">
          {/* `min-w-0` lets the title column shrink so the status plate can wrap
              below it on a phone instead of being pushed off the right edge
              (#1810); the flip side is that the column may then be narrower
              than a long unbroken Russian word («коморбидность»,
              «инсулинотерапия»), whose overflow spills past the hero and gives
              the whole page a horizontal scroll at 320–360 px. `break-words`
              (inherited by the kicker, the h1 and the date line) lets the word
              break at the measure instead — the plate keeps the canvas
              geometry, the title keeps the viewport. */}
          <div className="min-w-0 max-w-3xl break-words">
            <div className="text-eyebrow font-extrabold uppercase tracking-micro text-hero-muted">
              {kicker}
            </div>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-balance text-hero-foreground layout:text-4xl">
              {title}
            </h1>
            <div className="mt-4 text-base font-bold tabular-nums text-hero-muted layout:text-lg">
              {dateLine}
            </div>
            {chips && chips.length > 0 ? (
              <div
                data-testid="event-page-hero-chips"
                className="mt-5 flex flex-wrap gap-2"
              >
                {chips.map((chip, index) => (
                  <span
                    key={index}
                    className="border-2 border-blue-300 px-3 py-1 text-caption font-bold text-hero-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {statusPlate ? (
            <div data-testid="event-page-hero-status" className="mt-2 flex-none rotate-3">
              {statusPlate}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export interface EventPageShellProps {
  /** Normally an {@link EventPageHero}; a slot so a host can wrap it. */
  hero?: React.ReactNode;
  /** The single right-hand column (F-020-1 variant А: exactly ONE card). */
  aside?: React.ReactNode;
  /** The left reading flow — about, programme, speaker, format block. */
  children?: React.ReactNode;
  className?: string;
}

export function EventPageShell({
  hero,
  aside,
  children,
  className,
}: EventPageShellProps) {
  return (
    <div data-testid="event-page-shell" className={cn("bg-background", className)}>
      {hero}
      {/*
       * The body's OUTER box carries the gutter and the inner box carries
       * `max-w-content` — the exact nesting `EventPageHero` uses. Putting both
       * on one element would be a border-box (Tailwind preflight) whose 69rem
       * INCLUDES the gutter, so the reading column would sit one gutter inside
       * the hero's text column and be two gutters narrower than the canvas
       * (owner Stage-B finding, #1779): the canvas aligns the hero text and the
       * body flow on ONE left edge.
       */}
      <div className="relative z-10 -mt-20 px-4 pb-16 layout:px-gutter layout:pb-24">
        <main
          data-testid="event-page-main"
          className={cn(
            "mx-auto grid max-w-content grid-cols-1 gap-10",
            "layout:grid-cols-[1fr_360px] layout:gap-12",
          )}
        >
          {/*
           * DOM order keeps the reading flow first; the canvas puts the sign-up
           * card ABOVE it on mobile (`order:-1`), so the visual order flips with
           * `order-first` below the `layout` breakpoint only.
           */}
          {/*
           * 020 EARS-2 (#1765) — the OPEN PART: everything a guest reads without
           * registering. Addressable so the live tier can assert the whole
           * decision set, and its guest/signed-in identity, as one subtree.
           */}
          <div
            data-testid="event-page-open-part"
            className="min-w-0 pt-2 layout:pt-26"
          >
            {children}
          </div>
          <aside
            data-testid="event-page-aside"
            className="order-first min-w-0 layout:order-none"
          >
            {aside}
          </aside>
        </main>
      </div>
    </div>
  );
}

/**
 * The canvas's section rule — an uppercase micro-label followed by a 2px
 * hairline that runs to the column edge. Shared page chrome for the left-flow
 * sections, exported from `blocks/index.ts` and catalogued in the showcase: the
 * sections that use it (`EventAboutSection`, `EventProgrammeSection`,
 * `EventSpeakerCard`) compose it, and a host mounting a left-flow section of its
 * own uses this rule rather than re-typing its two class strings.
 */
export function EventSectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-4", className)}>
      <span className="text-caption font-extrabold uppercase tracking-micro whitespace-nowrap text-foreground">
        {children}
      </span>
      <span className="flex-1 border-t-2 border-border" />
    </div>
  );
}
