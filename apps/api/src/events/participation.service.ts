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
 */
@Injectable()
export class ParticipationService {
  constructor(
    @Inject(EventsRepository) private readonly events: EventsRepository,
    @Inject(RegistrationService)
    private readonly registration: RegistrationService,
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

    return resolveParticipationCta(
      {
        slug: found.event.slug,
        state,
        format: found.event.participationFormat,
        seatsLeft: found.event.seatsLeft,
        registered: await this.isRegistered(found.event.slug, sub),
      },
      routes,
    );
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
