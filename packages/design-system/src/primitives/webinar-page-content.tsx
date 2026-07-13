import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist event-page content set (004 EARS-2, source
 * `design-source/webinar-page.dc.html`). The two-column body of the public event
 * page — the complete decision set from the `PublicEventPage` projection laid out
 * to the canvas:
 *
 *   • left (`1fr`)   the «О чём эфир» description, the downloadable program PDF
 *                    affordance (when the event carries one), and the sponsor
 *                    plate (backing partners, label-only).
 *   • right (`380px`) the «Спикеры» aside — one bordered, soft-raised card per
 *                    speaker (64px tint initials square, name + credentials).
 *
 * Off-scale canvas geometry lives HERE, in the design-system SoT, not in app
 * code: the `1fr 380px` desktop grid track and the 64px avatar are computed
 * dimensions the app-scoped `no-arbitrary-tailwind-value` gate forbids in
 * `apps/*` (the rule's own SCOPE note exempts the DS component layer). Colour +
 * type flow through tokens → light/dark flips automatically. Speaker cards carry
 * the soft 4px recede-cast (`shadow-ghost` = `4px 4px 0` elevation-soft, the
 * exact canvas value in both themes) so they sit visually behind the status
 * card's strong 6px cast.
 *
 * ALL user-facing copy is injected (EARS-13): the page resolves the section
 * labels and the sponsor note through the 003 message catalog and passes them in
 * — no string is hardcoded here. МСК time and the hero (title, kicker, start
 * time, specialty chips) belong to the page shell (EARS-1); the status card + CTA
 * are siblings EARS-3/4/5 and are intentionally NOT rendered here.
 *
 * Canvas deltas (the projection is thinner than the illustrative canvas):
 *   • the timed agenda rows (01/02/03) are illustrative — wave-1 has no agenda
 *     field, so the «О чём эфир» description + the program-PDF download stand in.
 *   • the dashed «Лого спонсора» box is dropped — partners are label-only (no
 *     logo asset), and a dashed placeholder would be a fake affordance (no-stub).
 *   • the school-stats tint block (episode/subscriber counts) is dropped — those
 *     figures are not in the publish-safe projection.
 */
export interface WebinarPageSpeaker {
  /** Speaker display name (the projection is name + credentials — no contact PII). */
  name: string;
  /** Credentials / regalia, rendered under the name (may be empty). */
  credentials?: string;
}

export interface WebinarPagePartner {
  /** Backing-partner display label only — no commercial terms cross the public body. */
  label: string;
}

export interface WebinarPageContentProps
  extends React.ComponentPropsWithoutRef<"div"> {
  /** The «О чём эфир» free-text description from the projection. */
  description: string;
  /** Faculty — one card each (name + optional credentials). */
  speakers?: readonly WebinarPageSpeaker[];
  /** Backing partners (empty → the sponsor plate is omitted). */
  partners?: readonly WebinarPagePartner[];
  /** The program PDF URL; OMITTED (not null) ⇒ no download affordance renders (EARS-2). */
  programPdfUrl?: string;
  /** «О чём эфир» section label (copy from the catalog, EARS-13). */
  aboutLabel: string;
  /** «Программа» section label (copy from the catalog). */
  programLabel: string;
  /** Program-download link label, e.g. «Скачать программу (PDF)» (copy from the catalog). */
  programDownloadLabel: string;
  /** «Спикеры» section label (copy from the catalog). */
  speakersLabel: string;
  /** «При поддержке» sponsor-plate eyebrow (copy from the catalog). */
  sponsorEyebrow: string;
  /** The sponsor-independence note copy (copy from the catalog). */
  sponsorNote: string;
}

/** Uppercase 1–2-letter initials for the speaker avatar (`Анна Соколова` → `АС`). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

/** A section header — an uppercase micro-label with a 2px ink rule filling the row. */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-7 flex items-baseline gap-4">
      <span className="text-caption font-extrabold uppercase tracking-micro whitespace-nowrap text-foreground">
        {children}
      </span>
      <span aria-hidden="true" className="h-0 flex-1 border-t-2 border-foreground" />
    </div>
  );
}

function SpeakerCard({ name, credentials }: WebinarPageSpeaker) {
  return (
    <div className="flex gap-4 border-2 border-border bg-card p-6 text-card-foreground shadow-ghost">
      <span
        aria-hidden="true"
        className="flex size-16 shrink-0 items-center justify-center bg-tint text-lg font-extrabold text-tint-foreground"
      >
        {initials(name)}
      </span>
      <div>
        <div className="text-base font-bold text-card-foreground">{name}</div>
        {credentials ? (
          <div className="mt-1.5 text-caption leading-relaxed text-muted-foreground">
            {credentials}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const WebinarPageContent = React.forwardRef<
  HTMLDivElement,
  WebinarPageContentProps
>(
  (
    {
      className,
      description,
      speakers = [],
      partners = [],
      programPdfUrl,
      aboutLabel,
      programLabel,
      programDownloadLabel,
      speakersLabel,
      sponsorEyebrow,
      sponsorNote,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        // Base (≤900px): a single stacked column. Desktop (>900px): the canvas
        // `1fr 380px` split (main + speakers aside), gap clamp(32,56)≈gap-14.
        "grid gap-12 layout:grid-cols-[1fr_380px] layout:gap-14",
        className,
      )}
      {...props}
    >
      {/* Left column — description, program PDF, sponsor plate. */}
      <div>
        <SectionHeader>{aboutLabel}</SectionHeader>
        <p className="text-base leading-relaxed text-pretty text-foreground">
          {description}
        </p>

        {programPdfUrl ? (
          <div className="mt-12">
            <SectionHeader>{programLabel}</SectionHeader>
            {/* Program-download affordance — `text-primary-action` (blue.700
                light / #6BB1F7 dark) is the card-safe AA link token (#270), NOT
                `text-primary` (blue.500, fails AA on the card surface). */}
            <a
              href={programPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-3 border-2 border-border bg-card px-6 py-4 text-sm font-bold text-primary-action no-underline shadow-ghost focus-visible:shadow-focus focus-visible:outline-none"
            >
              <span aria-hidden="true">↓</span>
              {programDownloadLabel}
            </a>
          </div>
        ) : null}

        {partners.length > 0 ? (
          <div className="mt-12 border-2 border-hairline px-7 py-6">
            <div className="text-eyebrow font-extrabold uppercase tracking-micro text-foreground">
              {sponsorEyebrow}
            </div>
            <div className="mt-2 text-base font-bold text-foreground">
              {partners.map((partner) => partner.label).join(" · ")}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
              {sponsorNote}
            </p>
          </div>
        ) : null}
      </div>

      {/* Right column — speakers aside. */}
      <aside>
        <SectionHeader>{speakersLabel}</SectionHeader>
        {speakers.length > 0 ? (
          <div className="flex flex-col gap-6">
            {speakers.map((speaker, i) => (
              <SpeakerCard key={`${speaker.name}-${i}`} {...speaker} />
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  ),
);
WebinarPageContent.displayName = "WebinarPageContent";

export { WebinarPageContent };
