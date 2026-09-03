import * as React from "react";

import { Link } from "../primitives/link";
import { cn } from "../lib/utils";
import { EventSectionHeading } from "./event-page-shell";

/**
 * 020 EARS-2 / EARS-18 (#1765) — the two left-flow sections of the shared event
 * page: «О чём событие» and «Программа».
 *
 * They live here for the reason the mapper does. Until this slice both hosts
 * carried a hand-composed copy of the same markup down to the class string, so
 * «the two storefronts render the same event» held only as long as nobody
 * touched one of them — the exact drift EARS-18 exists to prevent. A host now
 * supplies its copy and nothing else; the anatomy is one implementation.
 *
 * `EventPageKicker` is here too rather than in the shell, because it is the one
 * hero element whose SHAPE depends on the read model's per-host links: the
 * school is a link where a school page exists and plain text where it does not
 * (EARS-2 — absent, never dead).
 */

export interface EventAboutSectionProps {
  /** «О чём событие» — host copy. */
  heading: React.ReactNode;
  description: React.ReactNode;
  className?: string;
}

export function EventAboutSection({
  heading,
  description,
  className,
}: EventAboutSectionProps) {
  return (
    <section data-testid="event-about" className={cn(className)}>
      <EventSectionHeading>{heading}</EventSectionHeading>
      <p className="mt-7 text-base leading-relaxed text-pretty text-foreground">
        {description}
      </p>
    </section>
  );
}

export interface EventProgrammeSectionProps {
  /** «Программа» — host copy. */
  heading: React.ReactNode;
  /** «Скачать программу (PDF)» — host copy, used only with {@link downloadHref}. */
  downloadLabel: React.ReactNode;
  /**
   * The attached programme PDF. Present and absent are the section's two
   * shapes; there is no third «disabled download» shape.
   */
  downloadHref?: string;
  /**
   * The honest sentence shown when there is no PDF — lifecycle-specific, from
   * the shared mapper (`eventProgrammeContent`). The section renders this
   * rather than disappearing or standing empty: an empty labelled box and a
   * «скоро» promise are both banned (EARS-19).
   */
  statement?: React.ReactNode;
  className?: string;
}

export function EventProgrammeSection({
  heading,
  downloadLabel,
  downloadHref,
  statement,
  className,
}: EventProgrammeSectionProps) {
  return (
    <section data-testid="event-programme" className={cn("mt-14", className)}>
      <EventSectionHeading>{heading}</EventSectionHeading>
      {downloadHref ? (
        // Routed through the DS `Link` primitive so hover and focus behave
        // identically on both storefronts (EARS-18, #1764).
        <Link
          href={downloadHref}
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center gap-3 border-2 border-border bg-card px-6 py-4 text-sm shadow-ghost"
        >
          <span aria-hidden="true">↓</span>
          {downloadLabel}
        </Link>
      ) : (
        <p
          data-testid="event-programme-statement"
          className="mt-7 text-base leading-relaxed text-pretty text-muted-foreground"
        >
          {statement}
        </p>
      )}
    </section>
  );
}

export interface EventPageKickerProps {
  /** «Школа ортобиологии». */
  school: React.ReactNode;
  /** Present only where the serving host mounts a school page. */
  schoolHref?: string;
  /** «Онлайн» — the participation-format word. */
  formatLabel: React.ReactNode;
  className?: string;
}

export function EventPageKicker({
  school,
  schoolHref,
  formatLabel,
  className,
}: EventPageKickerProps) {
  return (
    <span data-testid="event-page-kicker" className={cn(className)}>
      {schoolHref ? (
        // The kicker sits on the theme-invariant navy poster band, where the
        // default link tone falls under AA — `on-primary` is the hero token
        // (axe `color-contrast`, ADR-0013).
        <Link href={schoolHref} tone="on-primary">
          {school}
        </Link>
      ) : (
        school
      )}
      {" · "}
      {formatLabel}
    </span>
  );
}
