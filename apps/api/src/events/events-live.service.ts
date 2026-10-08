import { Inject, Injectable } from "@nestjs/common";
import type {
  EventAudience,
  EventLiveStrip,
  EventsLiveRead,
} from "@ds/schemas";
import { PresenceRepository } from "../room/presence.repository.js";
import {
  ROOM_HEARTBEAT_INTERVAL_SECONDS,
  presenceWindowSeconds,
} from "../room/room.tokens.js";
import type { ParticipationRoutes } from "./participation-cta.resolver.js";
import { ParticipationService } from "./participation.service.js";
import { type LiveEventRow, EventsRepository } from "./events.repository.js";

/**
 * 019 EARS-6 (#1521) + wave-2 entry gate §4.3 D5 — «Идёт сейчас»: the ONE live
 * resolution both storefronts read, parameterised by audience. The doctor read
 * (`GET /v1/storefront/doctor/events/live`, audience `doctors`, targeted by the
 * remembered specialty) and the Academy read (`GET /v1/public/events/live`,
 * audience `experts`) differ only in what they hand in: the audience, the
 * doctor targeting and the calling host's route table. One selection, one
 * refresh interval, one self-clearing rule.
 *
 * ## Why this read exists at all
 *
 * Because the feed cannot carry it. An эфир that started before the rendered
 * horizon is excluded from the feed by the horizon's lower bound (stand
 * finding 2026-09-02), so a viewer arriving mid-эфир would otherwise see what
 * is still to come and no way into what is happening.
 *
 * ## Nothing is derived here that 006 or 020 already decide
 *
 * Liveness is 006's `state`. The ENTRY POLICY is 020's
 * {@link ParticipationService}: each strip asks for the participation CTA of
 * its event under the calling host's routes — `enter-room` means «registered,
 * the room is open», and its `href` is the room. Anything else, guest and
 * signed-in-unregistered alike, is sent to the event page, where 020 already
 * renders the honest next step.
 *
 * ## Two counts, one aggregate
 *
 * A registered viewer's count arrives with the CTA and excludes themself —
 * «коллеги» means other people (020 EARS-7). Everyone else is not in the room
 * and excludes nobody, so the count is read from the SAME
 * {@link PresenceRepository} aggregate over the SAME `2 × N` window.
 *
 * ## Several эфиры at once
 *
 * Every running эфир is a strip, earliest start first — the block shows two
 * and «Ещё N в эфире →» for the rest (019 «Amendment — 2026-10-05»). The order
 * is a deterministic tie-break over rows the selection already chose, not a
 * ranking: the strip has no score field and this method computes none.
 */
@Injectable()
export class EventsLiveService {
  constructor(
    @Inject(EventsRepository)
    private readonly repository: EventsRepository,
    @Inject(ParticipationService)
    private readonly participation: ParticipationService,
    @Inject(PresenceRepository)
    private readonly presence: PresenceRepository,
    @Inject(ROOM_HEARTBEAT_INTERVAL_SECONDS)
    private readonly heartbeatIntervalSeconds: number,
  ) {}

  async live(input: {
    /** The storefront the calling host serves (012 LD-12). */
    audience: EventAudience;
    /** The doctor storefront's targeting; `null` reads the whole audience. */
    directionIds: string[] | null;
    /** The calling host's route table — the only host-specific input. */
    routes: ParticipationRoutes;
    /** The authenticated subject, absent for a guest. */
    sub?: string | undefined;
  }): Promise<EventsLiveRead> {
    const rows = await this.repository.findLiveRows({
      audience: input.audience,
      directionIds: input.directionIds,
    });
    return Promise.all(rows.map((row) => this.toStrip(row, input)));
  }

  private async toStrip(
    row: LiveEventRow,
    input: { routes: ParticipationRoutes; sub?: string | undefined },
  ): Promise<EventLiveStrip> {
    const cta = await this.participation.cta(row.slug, input.routes, input.sub);
    const viewerIsRegistered = cta?.action === "enter-room";
    const href =
      viewerIsRegistered && cta.href !== null
        ? cta.href
        : input.routes.eventPath(row.slug);

    return {
      eventId: row.id,
      slug: row.slug,
      title: row.title,
      school: row.school,
      href,
      // Rendered as «до HH:MM МСК» and nothing else — no host branches on it.
      endsAt: new Date(
        row.startsAt.getTime() + row.durationMin * 60_000,
      ).toISOString(),
      presenceCount: viewerIsRegistered
        ? (cta.presenceCount ?? 0)
        : await this.presence.countLivePresence(
            row.id,
            presenceWindowSeconds(this.heartbeatIntervalSeconds),
          ),
      viewerIsRegistered,
    };
  }
}
