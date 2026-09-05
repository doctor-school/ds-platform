import { Inject, Injectable } from "@nestjs/common";
import {
  type EventLifecycleState,
  isPubliclyReachable,
  type ParticipationCta,
} from "@ds/schemas";
import {
  RegistrationService,
  UnknownSubjectError,
} from "../registration/registration.service.js";
import { PresenceRepository } from "../room/presence.repository.js";
import {
  ROOM_HEARTBEAT_INTERVAL_SECONDS,
  presenceWindowSeconds,
} from "../room/room.tokens.js";
import { EventsRepository } from "./events.repository.js";
import {
  type ParticipationRoutes,
  resolveParticipationCta,
} from "./participation-cta.resolver.js";

/**
 * 020 EARS-1 (#1764) — the read that serves the ONE participation policy to
 * both storefront hosts.
 *
 * ## Why the CTA is a sibling read, not a field of the event page
 *
 * 004 EARS-1 pins a hard property: a guest and a logged-in principal receive
 * BYTE-FOR-BYTE identical bodies from `GET /v1/public/events/:idOrSlug`, and
 * that route is `Cache-Control: public` on the strength of it. The participation
 * CTA is by definition per-viewer (it depends on whether THIS reader holds a
 * registration), so embedding it in that body would either break the identity
 * property or poison a shared cache with one doctor's «Вы записаны». It is
 * therefore its own private, per-viewer read alongside the public page — the
 * same split 005's `GET /v1/events/:idOrSlug/registration` already uses, widened
 * here to accept an OPTIONAL principal so a guest gets a policy answer too
 * (a guest must be told «Участвовать», not 401).
 *
 * ## One policy, two hosts
 *
 * The lifecycle, format and seat facts come from feature 004/007's single event
 * row; the registration fact comes from feature 005's canonical service (never
 * a second query against `registrations` here); the host supplies only its route
 * table. The decision itself is the one pure
 * {@link resolveParticipationCta} function.
 *
 * ## The presence count (020 EARS-7)
 *
 * «Room entry carrying the presence count of colleagues already there» is a
 * LIVE fact, not policy, so it is read HERE rather than inside the pure
 * resolver: the resolver decides the action, and the one action that means «the
 * room is open to you» is then enriched with the same distinct-doctor aggregate
 * the 006 room grant carries, over the same `2 × N` freshness window derived from
 * the same server-config cadence — MINUS the viewer themself, because the line
 * reads «В эфире уже N коллег» and a colleague is someone other than you (the
 * 006 in-room header count deliberately keeps counting self: there it is the
 * room population). Reading it after the decision rather than
 * before is deliberate — it keeps the lifecycle ∧ registration condition stated
 * exactly once (a pre-fetch would have to re-state it here to avoid a query on
 * every guest page view) and costs no query on any other action.
 */
@Injectable()
export class ParticipationService {
  constructor(
    @Inject(EventsRepository) private readonly events: EventsRepository,
    @Inject(RegistrationService)
    private readonly registration: RegistrationService,
    @Inject(PresenceRepository)
    private readonly presence: PresenceRepository,
    @Inject(ROOM_HEARTBEAT_INTERVAL_SECONDS)
    private readonly heartbeatIntervalSeconds: number,
  ) {}

  /**
   * Resolve the participation CTA for one event as seen by `sub` (absent for a
   * guest), rendered against `routes` (the calling host's own paths).
   *
   * Returns `null` for an event with no public projection — a `draft` or an
   * unknown id — so the controller answers 404 exactly as the page read does
   * (004 EARS-6: a hidden draft leaks no «exists but private» oracle, and the
   * participation route must not become the oracle the page read refuses to be).
   */
  async cta(
    idOrSlug: string,
    routes: ParticipationRoutes,
    sub?: string,
  ): Promise<ParticipationCta | null> {
    const found = await this.events.findByIdOrSlug(idOrSlug);
    if (!found) return null;
    const state = found.event.state as EventLifecycleState;
    if (!isPubliclyReachable(state)) return null;

    const cta = resolveParticipationCta(
      {
        slug: found.event.slug,
        state,
        format: found.event.participationFormat,
        seatsLeft: found.event.seatsLeft,
        registered: await this.isRegistered(found.event.slug, sub),
      },
      routes,
    );

    // 020 EARS-7 — only room entry carries the count, and only then is the
    // aggregate queried. It is an integer over the live heartbeat window, never
    // a roster and never per-doctor identity (006 EARS-8).
    if (cta.action !== "enter-room") return cta;
    // The copy says «коллег» — OTHER doctors. `enter-room` is only ever reached
    // by a registered principal, so `sub` is present; the viewer's own beats
    // (they may be reading this page from inside the room, or on a second tab)
    // are excluded rather than counted as company.
    const viewerUserId = sub ? await this.presence.findUserIdBySub(sub) : null;
    return {
      ...cta,
      presenceCount: await this.presence.countLivePresence(
        found.event.id,
        presenceWindowSeconds(this.heartbeatIntervalSeconds),
        viewerUserId,
      ),
    };
  }

  /**
   * Whether this viewer holds a registration. A guest (no `sub`) is `false`
   * without a query. An authenticated subject with no mirror row yet is also
   * `false` rather than an error: the honest answer for someone who provably
   * holds no registration is «not registered», and failing the whole page read
   * over a mirror lag would turn a 003 timing artefact into a broken event page.
   */
  private async isRegistered(slug: string, sub?: string): Promise<boolean> {
    if (!sub) return false;
    try {
      const state = await this.registration.state(slug, sub);
      return state.registered;
    } catch (err) {
      if (err instanceof UnknownSubjectError) return false;
      throw err;
    }
  }
}
