import * as React from "react";

import { cn } from "../lib/utils";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";

/**
 * `LiveEventStrip` (019 EARS-6, #1521) — the «Идёт сейчас» strip that sits ABOVE
 * the doctor events feed (canvas `design-source/doctor-events.dc.html` L164-175 +
 * L717, вариант А of развилка 3, the owner-approved fork).
 *
 * The strip is PRESENTATION ONLY. Liveness, the entry policy (room vs event page)
 * and the presence count are resolved by the server and arrive as finished strings
 * and hrefs — this block never looks at a start time, never derives «идёт ли эфир»
 * and never decides where the action leads (019-design §4: «the client never
 * derives liveness from `startsAt`»). That is why there is no `startsAt`, no
 * `state` and no `viewerIsRegistered` prop here: the host passes the label and the
 * href the API already chose.
 *
 * Absence is the empty state. When nothing is live the HOST renders nothing at
 * all — this block has no «ничего не идёт» variant, because an empty red frame
 * would announce a running эфир that does not exist (019-design §3 dataState
 * matrix: the live block is ABSENT from the tree, not hidden).
 *
 * The LIVE announcement for assistive tech (019 EARS-13) is the `Badge`
 * `variant="live"` — the danger-red pill with the pulsing dot, which defaults to
 * `role="status"`, so the strip appearing mid-session is announced politely
 * without a second live region.
 *
 * Frame: `border-2 border-live` plus the `shadow-live` offset cast — the 6px hard
 * cast of `shadow-lg` composed from the `live` status colour instead of the blue
 * elevation tone, so the frame and its shadow read as one red signal (the token is
 * `shadow.live` in `tokens/primitive.json`, added with this block). The cast is
 * desktop-only (`lg:`) exactly as the canvas has it — below `lg` the offset would
 * push past the page gutter, so the strip carries the border alone and its
 * contents wrap.
 */
export interface LiveEventStripProps {
  /** «Идёт сейчас» — the badge copy; host-owned, never hardcoded here. */
  liveLabel: React.ReactNode;
  /** Event title, rendered as the link to the event's own surface. */
  title: React.ReactNode;
  /** Where the title leads — the event page, always (the ACTION may lead elsewhere). */
  titleHref: string;
  /**
   * The single server-composed meta line, e.g. «412 в комнате · Школа
   * ортобиологии · до 20:30 МСК». One string: the host owns the separators, the
   * plural form and the timezone suffix, so the block cannot drift from the copy.
   */
  meta: React.ReactNode;
  /**
   * «Войти в комнату эфира» for a registered doctor, «Открыть страницу события»
   * for everyone else — the host label matching the server-resolved `actionHref`.
   */
  actionLabel: React.ReactNode;
  /** The server-resolved destination: the room for a registered viewer, else the event page. */
  actionHref: string;
  className?: string;
}

const LiveEventStrip = React.forwardRef<HTMLElement, LiveEventStripProps>(
  (
    { liveLabel, title, titleHref, meta, actionLabel, actionHref, className },
    ref,
  ) => {
    const titleId = React.useId();

    return (
      <section
        ref={ref}
        aria-labelledby={titleId}
        data-testid="live-event-strip"
        className={cn(
          "mb-7 flex flex-wrap items-center gap-4.5 border-2 border-live bg-card p-4",
          "lg:mb-11 lg:p-6 lg:shadow-live",
          className,
        )}
      >
        <Badge variant="live" className="flex-none">
          {liveLabel}
        </Badge>
        <div className="min-w-55 flex-1">
          <a
            id={titleId}
            href={titleHref}
            data-testid="live-event-strip-title"
            className="block cursor-pointer text-lg font-extrabold leading-tight tracking-tight text-card-foreground hover:text-primary-action focus-visible:text-primary-action active:text-primary-pressed"
          >
            {title}
          </a>
          <p
            data-testid="live-event-strip-meta"
            className="mt-1.5 text-caption font-bold tabular-nums text-muted-foreground"
          >
            {meta}
          </p>
        </div>
        <Button asChild size="lg" className="flex-none">
          <a href={actionHref} data-testid="live-event-strip-action">
            {actionLabel}
          </a>
        </Button>
      </section>
    );
  },
);
LiveEventStrip.displayName = "LiveEventStrip";

export { LiveEventStrip };
