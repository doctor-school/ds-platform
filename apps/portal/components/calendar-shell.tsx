import type { ReactNode } from "react";
import { Container } from "@ds/design-system/container";

/**
 * 004 EARS-7/EARS-19 — the STATIC discovery shell shared by the «Неделя» and
 * «Месяц» panes of `/webinars` (004 owner verdict #3 on #1052). Both panes render
 * through this one component so the poster hero band and the content column are
 * pixel-identical across a «Неделя ⇄ Месяц» round-trip — only the toolbar controls
 * and the pane below swap. The unification points the owner called out:
 *
 *   • ONE content column — `<Container variant="calendar">` (1240px of content,
 *     the rework-#3 width) for BOTH panes, so the column edges never jump.
 *   • ONE hero geometry — the same navy band, paddings, and H1/subtitle/tagline
 *     scale (the month pane's hero is the base); the switcher sits at the same
 *     position, pulled up ONTO the band, in both panes.
 *
 * The live behavior is the SoT here (owner's explicit call — the design mockup is
 * NOT re-touched). Presentation-only: the app hands in the title/subtitle/tagline
 * copy, the composed `toolbar` (the pane's controls row + mobile switch row), and
 * the pane `children`.
 */
export function CalendarShell({
  title,
  subtitle,
  taglineTop,
  taglineBottom,
  toolbar,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  taglineTop: string;
  taglineBottom: string;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Poster hero — the shared navy band (blue.500 light / blue.700 dark), NO
          kicker, h1 + subtitle left, the uppercase tagline bottom-right; deep
          bottom padding so the pulled-up toolbar sits ON the band. */}
      <header className="bg-hero text-hero-foreground">
        <Container
          variant="calendar"
          className="flex flex-wrap items-end justify-between gap-8 pt-8 pb-10 layout:pt-10 layout:pb-25"
        >
          <div>
            <h1 className="text-3xl leading-none font-extrabold tracking-tight text-balance layout:text-4xl">
              {title}
            </h1>
            <p
              className="mt-4 text-body-compact font-semibold text-hero-muted"
              data-testid="poster-decor"
            >
              {subtitle}
            </p>
          </div>
          <div
            className="pb-1.5 text-xs leading-loose font-extrabold uppercase tracking-micro text-hero-muted"
            data-testid="poster-decor"
          >
            {taglineTop}
            <br />
            <span className="text-hero-foreground">{taglineBottom}</span>
          </div>
        </Container>
      </header>

      <Container
        variant="calendar"
        className="relative z-10 mt-6 pb-16 layout:-mt-15 layout:pb-24"
      >
        {toolbar}
        {children}
      </Container>
    </main>
  );
}
