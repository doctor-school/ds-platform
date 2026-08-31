import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist «запись готовится» PLAQUE (014 EARS-7, source
 * `design-source/webinar-archive.dc.html` — the `isPreparing` prep-card
 * artboard). It occupies the PLAYER position on a post-live event page whose
 * recording is not published yet: design §8.1 says the player card holds exactly
 * one of the player, the guest gate, the plaque, or the unavailability message,
 * so this component is one arm of that mutually exclusive set — never an overlay
 * on top of another arm.
 *
 * Geometry is the {@link WebinarStatusCard} card system, deliberately: the
 * plaque is the same object family as the status card above it (the same
 * `196px 1fr` desktop grid, 2px border, `6px 6px 0` cast, full-bleed borderless
 * ≤900px), so a post-live page reads as one card stack rather than two
 * competing card languages.
 *
 *   • time plate  the tinted left column: the micro LABEL («Запись») and, when
 *                 the operator committed to a readiness day, the formatted value
 *                 («до 18 июля»). With no committed day the VALUE IS OMITTED —
 *                 the canvas's «≈2 дня» is placeholder copy, and printing an
 *                 invented estimate would be a promise the operator never made.
 *   • body        the plaque head («Запись готовится») and the honest one-line
 *                 explanation, dated or date-free.
 *
 * Deliberately NO affordance (contrast the canvas, which sketches a «Напомнить
 * на почту» button): «your recording is ready» notifications are an explicit 014
 * non-goal, so that button would be a dead affordance — banned. The plaque is a
 * STATEMENT; the page it lives on carries the recording's only real actions.
 *
 * ALL copy is injected — the host resolves it through the message catalog and
 * formats the day; no string and no date math live here.
 */
export interface WebinarRecordingPlaqueProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "title"> {
  /** The time-plate micro label — «Запись» (from the catalog). */
  timeLabel: string;
  /**
   * The formatted readiness day — «до 18 июля» — or `null`/omitted when the
   * operator committed to no day. Omitted renders NO value line at all
   * (hide-until-content), never a placeholder dash or an invented estimate.
   */
  time?: string | null;
  /** The plaque head — «Запись готовится» (from the catalog). */
  title: string;
  /** The one-line explanation under the head, dated or date-free. */
  body: string;
}

const WebinarRecordingPlaque = React.forwardRef<
  HTMLDivElement,
  WebinarRecordingPlaqueProps
>(({ className, timeLabel, time, title, body, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      // Base (≤900px): flat, full-bleed, borderless — the card-stack baseline.
      "block bg-card text-card-foreground -mx-4",
      // Desktop (>900px): the 196px time-plate grid on a bordered, raised card.
      "layout:mx-0 layout:grid layout:grid-cols-[196px_1fr] layout:border-2 layout:border-border layout:shadow-lg",
      className,
    )}
    {...props}
  >
    {/* Time plate — label, and the committed day only when there is one. */}
    <div className="flex flex-col items-start gap-2.5 bg-tint px-4 py-[14px] layout:gap-3 layout:border-r-2 layout:border-border layout:px-6 layout:py-[30px]">
      <div className="text-eyebrow font-extrabold uppercase tracking-micro text-tint-foreground">
        {timeLabel}
      </div>
      {time ? (
        <span
          data-testid="recording-plaque-date"
          className="text-2xl font-extrabold leading-none tracking-tighter text-tint-foreground layout:text-3xl"
        >
          {time}
        </span>
      ) : null}
    </div>

    {/* Body — the head and the honest explanation. No CTA slot by design. */}
    <div className="flex flex-col gap-4 p-5 layout:px-8 layout:py-7">
      <div className="min-w-[200px]">
        <div className="text-lg font-bold tracking-tight text-card-foreground layout:text-title-lg">
          {title}
        </div>
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </div>
      </div>
    </div>
  </div>
));
WebinarRecordingPlaque.displayName = "WebinarRecordingPlaque";

export { WebinarRecordingPlaque };
