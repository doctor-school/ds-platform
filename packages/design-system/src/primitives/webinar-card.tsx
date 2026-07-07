import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist webinar listing card (004 EARS-8, source
 * `design-source/webinar-card.dc.html`). The reusable listing UNIT that carries
 * the `UpcomingBroadcastCard` choose-set and links the whole card to its event
 * page (EARS-1). Two visual pieces map straight onto the canvas:
 *
 *   • time plate  the tinted left column (desktop `196px` grid track, mobile a
 *                 full-bleed top strip): the 56px display time (`text-4xl`,
 *                 tabular-nums), an explicit «МСК» micro-label (EARS-12), and the
 *                 «day · weekday» sub-label.
 *   • content     school kicker (uppercase, `primary`), the title (the card's
 *                 accessible link label), the specialty chips, and the speakers.
 *
 * Geometry lives HERE, in the design-system SoT, not in app code: the `196px`
 * grid track and the exact time-plate paddings are computed dimensions off the
 * app spacing scale, which the app-scoped `no-arbitrary-tailwind-value` +
 * rhythmguard gates forbid in `apps/*` (the eslint rule's own SCOPE note: "the
 * component layer there... may, narrowly, need a computed dimension"). Colour +
 * type flow through tokens → light/dark flip automatically. Square, 2px border,
 * `6px 6px 0` elevation cast (`shadow-lg`) on desktop; flat full-bleed with a
 * bottom divider ≤900px, matching the canvas responsive split.
 *
 * The whole card is ONE block-level link (no nested interactive) — on the
 * listing the affordance is "open the event page", so the canvas's own CTA row
 * (which belongs to the event PAGE, EARS-3) is intentionally not rendered here.
 */
export interface WebinarCardSpeaker {
  /** Speaker display name (the card projection is name-only — no PII/credentials). */
  name: string;
  /** Optional affiliation, rendered after an em-dash when present. */
  org?: string;
}

export interface WebinarCardProps
  extends Omit<React.ComponentPropsWithoutRef<"a">, "title" | "children"> {
  /** The event page URL the whole card links to (`/webinars/:slug`, EARS-8). */
  href: string;
  /** Start time already formatted in Europe/Moscow, e.g. `19:00` (EARS-12). */
  time: string;
  /** The explicit timezone label — «МСК» (copy from the catalog, EARS-13). */
  tzLabel: string;
  /** «day · weekday» sub-label, e.g. `16 июля · ср` (copy from the catalog). */
  dateLabel: string;
  /** School / series kicker. */
  school: string;
  /** Event title — the card's accessible link label. */
  title: string;
  /** Target specialty chips (empty → the chip row is omitted). */
  specialties?: readonly string[];
  /** Faculty, rendered one bold name per line. */
  speakers?: readonly WebinarCardSpeaker[];
  /** Whether the event is airing now — surfaces the «В эфире» live signal (EARS-9). */
  live?: boolean;
  /** Live-signal copy — «В эфире» (from the catalog); required visually when `live`. */
  liveLabel?: string;
}

/** The pulsing round dot shared by the desktop sticker and the mobile live tag. */
function LiveDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.75 shrink-0 rounded-full bg-live-foreground animate-live-pulse"
    />
  );
}

const WebinarCard = React.forwardRef<HTMLAnchorElement, WebinarCardProps>(
  (
    {
      className,
      href,
      time,
      tzLabel,
      dateLabel,
      school,
      title,
      specialties = [],
      speakers = [],
      live = false,
      liveLabel,
      ...props
    },
    ref,
  ) => (
    <a
      ref={ref}
      href={href}
      className={cn(
        // Base (≤900px): flat, full-bleed, borderless with a bottom divider that
        // drops on the last card of a day group (the canvas mobile rhythm).
        "group relative block bg-card text-card-foreground no-underline",
        "border-b-2 border-border last:border-b-0",
        // Desktop (>900px): the 196px time-plate grid on a bordered, raised card.
        "layout:grid layout:grid-cols-[196px_1fr] layout:border-2 layout:border-border layout:shadow-lg layout:last:border-2",
        "focus-visible:outline-none focus-visible:shadow-focus",
        className,
      )}
      {...props}
    >
      {/* Live «sticker» — desktop only, rotated + poking above the top border. */}
      {live && liveLabel ? (
        <span
          role="status"
          className="absolute -top-4 right-6 z-10 hidden rotate-3 items-center gap-2 bg-live px-[15px] py-2 text-xs font-extrabold uppercase tracking-micro text-live-foreground shadow-sm layout:inline-flex"
        >
          <LiveDot />
          {liveLabel}
        </span>
      ) : null}

      {/* Time plate. */}
      <div className="flex flex-col items-start gap-2.5 bg-tint px-4 py-[14px] layout:items-start layout:gap-3 layout:border-r-2 layout:border-border layout:px-6 layout:py-[30px]">
        {/* Live tag — mobile only (the desktop signal is the sticker above). */}
        {live && liveLabel ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.75 self-start bg-live px-[11px] py-[5px] text-2xs font-extrabold uppercase tracking-micro text-live-foreground layout:hidden"
          >
            <LiveDot />
            {liveLabel}
          </span>
        ) : null}

        {/* `display:contents` on desktop lets the time + meta lay out directly in
            the time-column flex; on mobile they stack inside their own column. */}
        <div className="flex w-full flex-col items-start gap-1 layout:contents">
          <span className="text-3xl font-extrabold leading-none tracking-tighter tabular-nums text-tint-foreground layout:text-4xl">
            {time}
          </span>
          <div className="text-left">
            <div className="text-eyebrow font-extrabold uppercase tracking-micro text-tint-foreground">
              {tzLabel}
            </div>
            <div className="mt-1 text-xs font-bold uppercase leading-snug tracking-wide text-tint-foreground">
              {dateLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Content. */}
      <div className="px-4 pt-4 pb-[18px] layout:px-8 layout:py-[30px]">
        {/* Kicker + title-hover paint `primary-action` (blue.700 light / #6BB1F7
            dark — the AA link-text token, #270 Primary Button precedent), NOT
            `primary` (blue.500): semantic.json flags blue.500 as fails-AA
            (3.69:1) for text on card surfaces — it is AA only on the pale tint.
            In dark the token IS the canvas accent (#6BB1F7) exactly. */}
        <div className="mb-3 text-xs font-extrabold uppercase tracking-micro text-primary-action">
          {school}
        </div>
        <h3 className="mb-4 text-lg font-bold leading-snug tracking-tight text-card-foreground group-hover:text-primary-action layout:text-title-lg">
          {title}
        </h3>

        {specialties.length > 0 ? (
          <div className="mb-5 flex flex-wrap gap-2">
            {specialties.map((chip) => (
              <span
                key={chip}
                className="bg-tint px-3.25 py-1.5 text-caption font-bold text-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        {speakers.length > 0 ? (
          <p className="text-caption leading-relaxed text-muted-foreground">
            {speakers.map((speaker, i) => (
              <React.Fragment key={`${speaker.name}-${i}`}>
                <b className="font-bold text-foreground">{speaker.name}</b>
                {speaker.org ? ` — ${speaker.org}` : null}
                {i < speakers.length - 1 ? <br /> : null}
              </React.Fragment>
            ))}
          </p>
        ) : null}
      </div>
    </a>
  ),
);
WebinarCard.displayName = "WebinarCard";

export { WebinarCard };
