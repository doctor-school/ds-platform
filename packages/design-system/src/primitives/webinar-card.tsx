import type { DoctorEventFormat } from "@ds/schemas";
import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

/**
 * Neo-brutalist webinar listing card (004 EARS-8, source
 * `design-source/webinar-card.dc.html`). The reusable listing UNIT that carries
 * the `UpcomingBroadcastCard` choose-set and links to its event page (EARS-1).
 * Two visual pieces map straight onto the canvas:
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
 * STRUCTURE — the card matches the canvas: the root is a non-anchor CONTAINER,
 * the TITLE is the link, and its `::after` stretches over the whole card so the
 * entire surface stays the "open the event page" affordance (`after:inset-0`,
 * the Bootstrap `stretched-link` pattern). This — not a whole-card `<a>` — is
 * what lets the card host a SECOND action without nesting an anchor inside an
 * anchor. On a registered + `live` event (006 EARS-6, «мои события») the caller
 * passes `ctaHref`/`ctaLabel` and the card renders a room-entry CTA («Войти в
 * эфир» → `/webinars/:slug/room`) as a SIBLING with a higher stacking context
 * (`relative z-10`), keeping both links keyboard-reachable and DOM-valid. The
 * public listing (004) simply omits the CTA and reads as a single card link.
 */
export interface WebinarCardSpeaker {
  /** Speaker display name (the card projection is name-only — no PII/credentials). */
  name: string;
  /** Optional affiliation, rendered after an em-dash when present. */
  org?: string;
}

export interface WebinarCardProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "title" | "children"
> {
  /** Canvas presentation state; `past` is the visually muted archive anatomy. */
  variant?: "upcoming" | "past";
  /** The event page URL the card's stretched title link points to (`/webinars/:slug`, EARS-8). */
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
  /** Source-free recording-state badge supplied by the host for an ended event. */
  recordingLabel?: string;
  /**
   * Whether the VIEWER is registered for this event — surfaces the canvas
   * `registered` variant's «вы записаны» marker (the green `✓` line, semantic
   * `success` token). Composed by the caller from the viewer's own registration
   * set (005 `MyEvents`); the public card projection itself never carries
   * per-user state (004 EARS-10 publish-safe invariant).
   */
  registered?: boolean;
  /** Registered-marker copy — «Вы записаны» (from the catalog); required visually when `registered`. */
  registeredLabel?: string;
  /**
   * 019 EARS-2 — the event FORMAT. The five-value vocabulary is owned by
   * `@ds/schemas` (`DoctorEventFormatSchema`), never restated here, so the card
   * and the read contract cannot drift. Each format renders with its OWN glyph
   * and its OWN surface token, so the five are distinguishable without reading
   * the text (the badge also carries `data-event-format` for host/test hooks).
   */
  format?: DoctorEventFormat;
  /** Catalog copy for the format badge; with no label no badge renders (no hardcoded copy). */
  formatLabel?: string;
  /** Catalog copy for the event KIND («Разбор клинического случая»). */
  kindLabel?: string;
  /** НМО copy — rendered as a BADGE ONLY (EARS-2/EARS-14: never a heading, never the primary filter). */
  nmoLabel?: string;
  /**
   * Cost in Pul attention points. `0` renders `freeLabel` («бесплатно для
   * врача»); any other value renders `pulCostLabel`. The card renders NO rouble
   * string in either branch — there is no rouble prop to render one from.
   */
  pulCost?: number;
  /** Catalog copy for a non-zero Pul cost, e.g. «120 Pul». */
  pulCostLabel?: string;
  /** Catalog copy for a zero Pul cost — «бесплатно для врача». */
  freeLabel?: string;
  /** Colleagues signed up — rendered in EVERY card state (EARS-2 invariant). */
  signUpCount?: number;
  /** Catalog noun phrase following the count, e.g. «коллег записались». */
  signUpLabel?: string;
  /** Offline city — required by EARS-2 wherever an offline event is rendered. */
  city?: string;
  /** Remaining seats for an offline event; `0` is the «мест не осталось» state. */
  seatsLeft?: number;
  /** Catalog noun phrase following the seat count, e.g. «мест осталось». */
  seatsLeftLabel?: string;
  /** Catalog copy for the sold-out state — «мест не осталось». */
  soldOutLabel?: string;
  /** Contextual CTA target: room entry for live cards, event page for past cards. */
  ctaHref?: string;
  /**
   * Catalog-owned CTA copy. The primitive ships no user-facing string of its own,
   * so with no label no CTA element renders (no hardcoded copy).
   */
  ctaLabel?: string;
}

/**
 * 019 EARS-2 — the format anatomy. Each of the five formats gets a DISTINCT
 * glyph AND a distinct surface token, so a reader tells them apart without
 * reading the badge text (the requirement's «visually distinguishable without
 * reading the text»). Surfaces are token pairs that already carry their own AA
 * foreground; the glyph is `aria-hidden` because it is redundant with the
 * adjacent catalog label (WCAG 1.4.11 exempt, the #270 precedent in this file).
 */
const FORMAT_ANATOMY: Record<
  DoctorEventFormat,
  { glyph: string; surface: string }
> = {
  webinar: { glyph: "▶", surface: "bg-tint text-tint-foreground" },
  "online-meeting": { glyph: "⧉", surface: "bg-accent text-accent-foreground" },
  "offline-meetup": { glyph: "⚑", surface: "bg-success text-success-foreground" },
  congress: { glyph: "▣", surface: "bg-primary-surface-muted text-foreground" },
  podcast: { glyph: "♪", surface: "bg-muted-2 text-foreground" },
};

/** The pulsing round dot shared by the desktop sticker and the mobile live tag. */
function LiveDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.75 shrink-0 rounded-full bg-live-foreground animate-live-pulse"
    />
  );
}

const WebinarCard = React.forwardRef<HTMLDivElement, WebinarCardProps>(
  (
    {
      className,
      variant = "upcoming",
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
      recordingLabel,
      registered = false,
      registeredLabel,
      format = "webinar",
      formatLabel,
      kindLabel,
      nmoLabel,
      pulCost,
      pulCostLabel,
      freeLabel,
      signUpCount,
      signUpLabel,
      city,
      seatsLeft,
      seatsLeftLabel,
      soldOutLabel,
      ctaHref,
      ctaLabel,
      ...props
    },
    ref,
  ) => {
    const past = variant === "past";
    const anatomy = FORMAT_ANATOMY[format] ?? FORMAT_ANATOMY.webinar;
    // EARS-2: the cost reads in Pul, and a zero cost reads «бесплатно для
    // врача». There is no rouble branch because there is no rouble input.
    const costLabel = pulCost === 0 ? freeLabel : pulCostLabel;
    // «мест не осталось» is the seat count reaching zero — one state, one source.
    const soldOut = seatsLeft === 0;

    return (
      <div
        ref={ref}
        data-webinar-card=""
        className={cn(
          // Base (≤900px): flat, full-bleed, borderless with a bottom divider that
          // drops on the last card of a day group (the canvas mobile rhythm).
          "group relative block bg-card text-card-foreground",
          "border-b-2 border-border last:border-b-0",
          // Desktop (>900px): the 196px time-plate grid on a bordered, raised card.
          "layout:grid layout:grid-cols-[196px_1fr] layout:border-2 layout:border-border layout:shadow-lg layout:last:border-2",
          past && "opacity-80 layout:border-muted-foreground/30",
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
              {recordingLabel ? (
                <div className="mt-1 text-xs font-bold uppercase leading-snug tracking-wide text-tint-foreground">
                  {recordingLabel}
                </div>
              ) : null}
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

          {/* 019 EARS-2 — format · kind · НМО badge row. The format badge is the
            at-a-glance format signal (own glyph + own surface per format); НМО
            appears HERE and only here, as a badge — never as a heading and never
            as the card's primary emphasis. Every string is caller-injected. */}
          {formatLabel || kindLabel || nmoLabel ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {formatLabel ? (
                <span
                  data-event-format={format}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3.25 py-1.5 text-caption font-extrabold",
                    anatomy.surface,
                  )}
                >
                  <span aria-hidden="true">{anatomy.glyph}</span>
                  {formatLabel}
                </span>
              ) : null}
              {kindLabel ? (
                <span
                  data-event-kind=""
                  className="inline-flex items-center px-3.25 py-1.5 text-caption font-bold text-muted-foreground"
                >
                  {kindLabel}
                </span>
              ) : null}
              {nmoLabel ? (
                <span
                  data-nmo-badge=""
                  className="inline-flex items-center border-2 border-border px-3.25 py-1.5 text-caption font-extrabold text-foreground"
                >
                  {nmoLabel}
                </span>
              ) : null}
            </div>
          ) : null}
          {/* The TITLE is the card's link. Its `::after` stretches over the whole
            root (`after:inset-0`, the root is `relative`), so clicking anywhere on
            the card opens the event page while only ONE anchor exists in the DOM —
            the structure that lets a secondary CTA sit alongside without nesting
            anchors. The focus ring rides the link (keyboard target); hover paints
            via the root `group`. */}
          <h3 className="mb-4 text-lg font-bold leading-snug tracking-tight layout:text-title-lg">
            <a
              href={href}
              className="text-card-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary-action focus-visible:text-primary-action focus-visible:after:shadow-focus"
            >
              {title}
            </a>
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

          {/* 019 EARS-2 — the facts row. It sits OUTSIDE every state branch on
            purpose: the sign-up count is required «in every card state», so it
            renders for the scheduled, live, registered, sold-out and past card
            alike, and cannot be switched off by a variant. An offline event
            additionally carries its city and its remaining seats here, so they
            travel wherever the card is rendered. */}
          {costLabel || typeof signUpCount === "number" || city ? (
            <div
              data-event-facts=""
              className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-muted-foreground"
            >
              {costLabel ? (
                <span data-event-cost="" className="font-extrabold text-foreground">
                  {costLabel}
                </span>
              ) : null}
              {typeof signUpCount === "number" ? (
                <span data-signup-count="">
                  <b className="font-bold text-foreground">{signUpCount}</b>
                  {signUpLabel ? ` ${signUpLabel}` : null}
                </span>
              ) : null}
              {city ? (
                <span data-event-city="" className="font-bold text-foreground">
                  {city}
                </span>
              ) : null}
              {typeof seatsLeft === "number" && !soldOut ? (
                <span data-event-seats="">
                  <b className="font-bold text-foreground">{seatsLeft}</b>
                  {seatsLeftLabel ? ` ${seatsLeftLabel}` : null}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-5">
            {speakers.length > 0 ? (
              <p className="min-w-45 text-caption leading-relaxed text-muted-foreground">
                {speakers.map((speaker, i) => (
                  <React.Fragment key={`${speaker.name}-${i}`}>
                    <b className="font-bold text-foreground">{speaker.name}</b>
                    {speaker.org ? ` — ${speaker.org}` : null}
                    {i < speakers.length - 1 ? <br /> : null}
                  </React.Fragment>
                ))}
              </p>
            ) : null}

            {past && ctaHref && ctaLabel ? (
              <div className="relative z-10">
                <Button asChild size="lg">
                  <a href={ctaHref}>{ctaLabel}</a>
                </Button>
              </div>
            ) : null}
          </div>

          {/* Registered marker — the canvas `registered` variant's «✓ …» line,
            sitting where the canvas CTA row lives (the listing card renders no
            CTA row — the whole card is the link). 13px/800 → text-caption +
            font-extrabold; `role="status"` mirrors the live signal (an
            at-a-glance state, not decoration). AA remap (the #270 precedent —
            canvas colors failing AA on `bg-card` take the card-safe token): the
            canvas paints the whole line green.500 (#009959), which is 3.68:1 on
            the light card — below the 4.5:1 normal-text floor — and the palette
            has no darker AA green. So the LABEL takes AA ink (`text-foreground`)
            and only the decorative ✓ keeps the success hue (`text-success`) —
            it is redundant with the adjacent label (WCAG 1.4.11 exempt). The
            canvas's «Отменить» affordance is feature 005's un-register command —
            not built, so no dead control renders here. */}
          {registered && registeredLabel ? (
            <p
              role="status"
              data-registered-marker=""
              className="mt-4 inline-flex items-center gap-1.5 text-caption font-extrabold text-foreground"
            >
              <span aria-hidden="true" className="text-success">
                ✓
              </span>
              {registeredLabel}
            </p>
          ) : null}

          {/* 019 EARS-2 — «мест не осталось». Derived from the seat count
            reaching zero (never a second boolean that could contradict it), and
            announced like the other at-a-glance states (`role="status"`). The
            card keeps its event-page link: a sold-out event is still readable,
            only its sign-up action is gone (that action lives in feature 021). */}
          {soldOut && soldOutLabel ? (
            <p
              role="status"
              data-sold-out-marker=""
              className="mt-4 inline-flex items-center gap-1.5 text-caption font-extrabold text-foreground"
            >
              {soldOutLabel}
            </p>
          ) : null}

          {/* 006 EARS-6 — room-entry CTA («Войти в эфир»). A SIBLING of the card's
            stretched title link (never nested inside it), lifted above the
            stretched-link overlay with its own stacking context (`relative z-10`)
            so it is the click target here and stays independently keyboard-
            reachable. Rendered only for a registered + `live` event (caller passes
            the hardened `ctaHref` + the catalog label); mirrors the event-page
            enter-room CTA styling (the DS `Button`, filled primary). */}
          {!past && ctaHref && ctaLabel ? (
            <div className="relative z-10 mt-5">
              <Button asChild size="lg">
                <a href={ctaHref}>{ctaLabel}</a>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
WebinarCard.displayName = "WebinarCard";

export { WebinarCard };
