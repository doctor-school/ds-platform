import * as React from "react";

import { cn } from "../lib/utils";
import { Link } from "../primitives/link";
import { EventSectionHeading } from "./event-page-shell";

/**
 * `EventSpeakerCard` (020 EARS-1, #1764) — the canvas's «Ведёт» card: the photo
 * tile (`220px 1fr` on desktop, photo on top below the `layout` breakpoint), the
 * role kicker, the name, the affiliation, the bio, and the expert-page footer
 * link.
 *
 * Every link is optional and ABSENT when its href is missing rather than dead
 * (EARS-4): an event whose speaker has no public expert page still renders the
 * card, minus the two links.
 */
export interface EventSpeakerCardProps {
  name: string;
  /** «Травматолог-ортопед» — the role kicker above the name. */
  roleKicker?: React.ReactNode;
  /** «РНИМУ им. Пирогова». */
  affiliation?: React.ReactNode;
  bio?: React.ReactNode;
  photoUrl?: string;
  photoAlt?: string;
  /** Initials shown while there is no photo — «МС». */
  initials?: string;
  /** The expert page; the name is a link only when this is set. */
  href?: string;
  /** «12 эфиров · страница эксперта →» — host-supplied, needs {@link footerHref}. */
  footerLabel?: React.ReactNode;
  footerHref?: string;
  /**
   * Canvas-fixed section label, rendered ONCE above the section. Pass `null`
   * to suppress it on every card after the first; `undefined` keeps the
   * canvas default «Ведёт».
   */
  heading?: React.ReactNode | null;
  className?: string;
}

export function EventSpeakerCard({
  name,
  roleKicker,
  affiliation,
  bio,
  photoUrl,
  photoAlt,
  initials,
  href,
  footerLabel,
  footerHref,
  heading = "Ведёт",
  className,
}: EventSpeakerCardProps) {
  return (
    <section data-testid="event-speaker-card" className={cn(className)}>
      {heading === null ? null : (
        <EventSectionHeading className="mb-7">{heading}</EventSectionHeading>
      )}
      <div className="grid grid-cols-1 border-2 border-border bg-card shadow-lg layout:grid-cols-[220px_1fr]">
        <div className="relative flex min-h-40 items-center justify-center overflow-hidden border-b-2 border-border bg-tint layout:min-h-50 layout:border-b-0 layout:border-r-2">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={photoAlt ?? name}
              className="size-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="text-4xl font-extrabold tracking-tight text-tint-foreground"
            >
              {initials}
            </span>
          )}
        </div>
        <div className="px-7 py-6">
          {roleKicker ? (
            <div className="mb-2 text-eyebrow font-extrabold uppercase tracking-micro text-primary-action">
              {roleKicker}
            </div>
          ) : null}
          {href ? (
            <Link
              href={href}
              className="inline-block text-xl font-extrabold leading-snug tracking-tight text-card-foreground hover:text-primary-action"
            >
              {name}
            </Link>
          ) : (
            <div className="text-xl font-extrabold leading-snug tracking-tight text-card-foreground">
              {name}
            </div>
          )}
          {affiliation ? (
            <div className="mt-1.5 text-caption font-bold text-faint">{affiliation}</div>
          ) : null}
          {bio ? (
            <div className="mt-3 text-caption leading-relaxed text-muted-foreground">
              {bio}
            </div>
          ) : null}
          {footerLabel && footerHref ? (
            <Link
              href={footerHref}
              variant="inline"
              className="mt-3.5 inline-block text-caption font-extrabold"
              data-testid="event-speaker-footer-link"
            >
              {footerLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
