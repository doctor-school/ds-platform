import { z } from "zod";

/**
 * 019 EARS-6 (#1521) — the «Идёт сейчас» contract of BOTH hosts' live reads:
 * `GET /v1/storefront/doctor/events/live` (audience `doctors`, targeted) and
 * `GET /v1/public/events/live` (audience `experts`) — one live resolution
 * parameterised by audience (wave-2 entry gate §4.2, §4.3 D5).
 *
 * Three invariants are expressed as types rather than as review etiquette:
 *
 * 1. **The client never derives liveness.** There is no `startsAt` and no
 *    `durationMin` in this contract — nothing a host could compare against its
 *    own clock to decide «this эфир must be running by now». Liveness is 006's
 *    lifecycle `state`, resolved on the server; `endsAt` is present only as the
 *    «до HH:MM МСК» line the canvas asks for, and no code branches on it.
 * 2. **Nothing live ⇒ an empty list, never an empty strip.** The read is
 *    `LiveStrip[]` ({@link EventsLiveReadSchema}), every running эфир the
 *    viewer may see, earliest start first; the block shows at most two strips
 *    and «Ещё N в эфире →» for the rest (019 «Amendment — 2026-10-05»). An
 *    empty list puts the block ABSENT from the tree, so there is no
 *    `visible: false` field and no empty-shape variant a host could render a
 *    hollow frame from.
 * 3. **The entry policy is the server's.** `href` is already resolved — the
 *    room for a registered viewer, the event page for everyone else — and
 *    `viewerIsRegistered` reports which of the two it is so a host can pick the
 *    label. No host re-derives room eligibility, so the doctor storefront
 *    cannot disagree with 020's participation CTA about who may enter.
 *
 * `.strict()` for the same reason the feed is: a `score`, `rank` or
 * `personalised` field added upstream is REJECTED at the boundary rather than
 * forwarded — «Идёт сейчас» is a lifecycle fact, never a recommendation.
 */
export const EventLiveStripSchema = z
  .object({
    eventId: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    /** The school the эфир belongs to — the canvas meta line's middle segment. */
    school: z.string(),
    /**
     * Where the action leads, resolved by the SERVER against 020's
     * participation policy: the room when this viewer holds a registration, the
     * event page otherwise. A guest and a signed-in-unregistered viewer get the
     * same event-page target — an impossible affordance is ABSENT, never dead.
     */
    href: z.string().min(1),
    /** ISO instant the эфир is scheduled to end — rendered as «до HH:MM МСК», never compared. */
    endsAt: z.iso.datetime({ offset: true }),
    /** Distinct doctors currently in the room over the live heartbeat window (006 EARS-5). */
    presenceCount: z.number().int().nonnegative(),
    /** Which of the two entry targets `href` carries — the label switch, not a second policy. */
    viewerIsRegistered: z.boolean(),
  })
  .strict();
export type EventLiveStrip = z.infer<typeof EventLiveStripSchema>;

/** The whole response body: every live strip, earliest start first; `[]` when nothing is live. */
export const EventsLiveReadSchema = z.array(EventLiveStripSchema);
export type EventsLiveRead = z.infer<typeof EventsLiveReadSchema>;

/**
 * The bounded refresh cadence of the block (019 LD-6). The strip is a LIVE fact
 * with a definite end, so the host re-reads it on this interval (and when the
 * tab becomes visible again) instead of holding a socket open for one badge or
 * — worse — arming a client-side timer against `startsAt`. Thirty seconds is
 * the same order as the feed's own `max-age=30`, so a room that closes clears
 * the block within one cadence with no reload.
 */
export const EVENTS_LIVE_REFRESH_SECONDS = 30;
