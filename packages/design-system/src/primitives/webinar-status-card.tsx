import * as React from "react";

import { cn } from "../lib/utils";
import { Badge } from "./badge";

/**
 * Neo-brutalist event-page STATUS CARD (004 EARS-4, source
 * `design-source/webinar-page.dc.html` — the pulled-up «статус-карточка»). The
 * lifecycle affordance the public event page swaps per `EventLifecycleState`:
 * the same time-plate geometry as {@link WebinarCard}, plus a body carrying the
 * head/sub signal and the single primary participation CTA slot.
 *
 *   • time plate  the tinted left column (desktop `196px` grid track, mobile a
 *                 full-bleed strip): a micro time-LABEL («Начало» / «Сейчас» /
 *                 «Прошёл»), the 56px display time (tabular-nums), and the
 *                 «day · МСК · …» sub-label (EARS-12 — МСК is copy, injected).
 *                 When the event is airing it also carries the «В эфире» live tag
 *                 (mobile; on desktop the live signal is the hero badge).
 *   • body        the head + sub lifecycle message and the CTA slot (`children`).
 *
 * The CTA is a SLOT, not baked in: the page owns route selection (EARS-3/4 —
 * upcoming → registration, live → the room seam 006, ended → NO CTA), so it
 * passes the single «Участвовать» primary action in, or nothing for the `ended`
 * render (no dead link — the exactly-one-CTA invariant, requirements Invariants).
 *
 * Off-scale canvas geometry lives HERE, in the design-system SoT, not in app
 * code: the `196px 1fr` desktop grid, the 2px border, and the `6px 6px 0`
 * elevation cast (`shadow-lg`) are computed dimensions the app-scoped
 * `no-arbitrary-tailwind-value` gate forbids in `apps/*` (its SCOPE note exempts
 * the DS component layer). Colour + type flow through tokens → light/dark flips
 * automatically. Square, 2px border + 6px cast on desktop; flat full-bleed with
 * no border ≤900px, matching the canvas responsive split and the card geometry.
 *
 * ALL user-facing copy is injected (EARS-13): the page resolves the labels,
 * head/sub, and the МСК sub-label through the 003 message catalog and passes
 * them in — no string is hardcoded here.
 */
export interface WebinarStatusCardProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "title"> {
  /** Whether the event is airing now — surfaces the «В эфире» live tag (EARS-9). */
  live?: boolean;
  /** Live-signal copy — «В эфире» (from the catalog); required visually when `live`. */
  liveLabel?: string;
  /** The time-plate micro label — «Начало» / «Сейчас» / «Прошёл» (from the catalog). */
  timeLabel: string;
  /** The display time already formatted in Europe/Moscow, e.g. `19:00` (EARS-12). */
  time: string;
  /** The «day · МСК · …» sub-label (МСК explicit, from the catalog, EARS-12/13). */
  timeSub: string;
  /** The lifecycle head line — «Регистрация открыта» / «Эфир уже идёт» / … . */
  head: string;
  /** The lifecycle sub line under the head. */
  sub: string;
  /**
   * The primary participation CTA slot. The page passes exactly one «Участвовать»
   * action (upcoming → registration, live → room seam) or NOTHING for the `ended`
   * render — a missing slot renders no CTA column (no dead link, EARS-4).
   */
  children?: React.ReactNode;
}

const WebinarStatusCard = React.forwardRef<
  HTMLDivElement,
  WebinarStatusCardProps
>(
  (
    { className, live = false, liveLabel, timeLabel, time, timeSub, head, sub, children, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        // Base (≤900px): flat, full-bleed, borderless (canvas `margin:0 -16px`).
        "block bg-card text-card-foreground -mx-4",
        // Desktop (>900px): the 196px time-plate grid on a bordered, raised card.
        "layout:mx-0 layout:grid layout:grid-cols-[196px_1fr] layout:border-2 layout:border-border layout:shadow-lg",
        className,
      )}
      {...props}
    >
      {/* Time plate. */}
      <div className="flex flex-col items-start gap-2.5 bg-tint px-4 py-[14px] layout:gap-3 layout:border-r-2 layout:border-border layout:px-6 layout:py-[30px]">
        {/* Live tag — mobile only (the desktop live signal is the hero badge). */}
        {live && liveLabel ? (
          <Badge variant="live" className="self-start layout:hidden">
            {liveLabel}
          </Badge>
        ) : null}
        <div className="text-eyebrow font-extrabold uppercase tracking-micro text-tint-foreground">
          {timeLabel}
        </div>
        <span className="text-3xl font-extrabold leading-none tracking-tighter tabular-nums text-tint-foreground layout:text-4xl">
          {time}
        </span>
        <div className="text-xs font-bold uppercase leading-snug tracking-wide text-tint-foreground">
          {timeSub}
        </div>
      </div>

      {/* Body — head/sub signal + the single CTA slot. */}
      <div className="flex flex-col gap-4 p-5 layout:flex-row layout:flex-wrap layout:items-center layout:justify-between layout:gap-6 layout:px-8 layout:py-7">
        <div className="min-w-[200px]">
          <div className="text-lg font-bold tracking-tight text-card-foreground layout:text-title-lg">
            {head}
          </div>
          <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {sub}
          </div>
        </div>
        {children ? (
          <div className="flex flex-wrap gap-3.5">{children}</div>
        ) : null}
      </div>
    </div>
  ),
);
WebinarStatusCard.displayName = "WebinarStatusCard";

export { WebinarStatusCard };
