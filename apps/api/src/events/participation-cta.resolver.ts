import {
  type EventParticipationFormat,
  type ParticipationCta,
  isRegistrable,
} from "@ds/schemas";
import type { EventLifecycleState } from "@ds/schemas";

/**
 * 020 EARS-1 / LD-2 / LD-5 (#1764) — the ONE participation-CTA policy.
 *
 * The whole point of LD-2 is that «exactly one CTA» is a SERVER fact: this
 * module is the only place in the platform that decides which affordance a
 * viewer is offered on an event. Both storefront hosts call it through their own
 * route; neither branches on lifecycle, registration, format or seats. A host
 * that grew such a branch would be able to disagree with the other host about
 * the same event, which is the F-020-3 Б defect the policy object exists to make
 * structurally impossible.
 *
 * It is a PURE function of the facts it is handed. It reads no database, holds
 * no clock and knows no host: the caller supplies the event's lifecycle state,
 * its participation format, its remaining seats, whether THIS viewer holds a
 * registration, and the host's own route table. That is what lets the identical
 * policy be exercised for six actions in unit-speed tests and still be the code
 * both live routes run.
 */

/**
 * The host-owned paths the policy turns into an `href` (LD-1: a host supplies
 * route, header, envelope and copy defaults — nothing else). The policy never
 * spells a path itself, so «where does registration live on doctor.school»
 * stays a fact of the doctor host rather than a second opinion inside the core.
 *
 * `roomPath` is nullable on purpose: a host that does not yet mount a room route
 * yields `enter-room` with `href: null`, and the page renders the state with no
 * link. EARS-4 is explicit that an impossible participation affordance is
 * ABSENT, never dead or disabled — a link into a route that does not exist would
 * be exactly the dead-end that rule forbids.
 */
export interface ParticipationRoutes {
  /** The event's own public page on this host — the return target (LD-9). */
  eventPath: (slug: string) => string;
  /** The host's registration entry, e.g. `/register`. */
  registrationEntry: string;
  /** The host's room route for the event, or `null` while it does not exist. */
  roomPath: ((slug: string) => string) | null;
}

/** The facts the policy resolves over. */
export interface ParticipationFacts {
  readonly slug: string;
  readonly state: EventLifecycleState;
  readonly format: EventParticipationFormat;
  /** `null` = no seat limit; `0` = мест нет. The two are different answers. */
  readonly seatsLeft: number | null;
  /** Whether THIS viewer holds a registration. A guest is always `false`. */
  readonly registered: boolean;
}

/**
 * RU copy defaults carried by the server, so both storefronts say the same thing
 * about the same event without agreeing out of band (LD-2). A host may later
 * override the LABEL through its envelope; it may never override the `action`.
 */
const LABELS: Record<ParticipationCta["action"], string> = {
  register: "Участвовать",
  registered: "Вы записаны",
  "enter-room": "Войти в эфир",
  "switch-to-online": "Участвовать онлайн",
  "sold-out": "Мест нет",
  unavailable: "Участие недоступно",
};

/**
 * `true` when the event's OFFLINE capacity is exhausted. Seats bind only where
 * there is a room with chairs: an `online` event has no offline half, so a
 * stray `seats_left = 0` on one can never invent a sold-out webinar.
 */
function offlineSeatsExhausted(facts: ParticipationFacts): boolean {
  if (facts.format === "online") return false;
  return facts.seatsLeft === 0;
}

/**
 * Build the same-origin registration handoff for this host: the host's
 * registration entry carrying the event page as the `returnTo` (LD-9 — the CTA
 * carries the event and the page's own URL into feature 021, which returns the
 * doctor to exactly that URL). The return target is percent-escaped, so a
 * hostile slug can never surface a protocol-relative or cross-origin target
 * (005 EARS-2 Constraints).
 */
function registrationHref(
  routes: ParticipationRoutes,
  slug: string,
): string {
  const params = new URLSearchParams({ returnTo: routes.eventPath(slug) });
  return `${routes.registrationEntry}?${params.toString()}`;
}

/**
 * Resolve the single {@link ParticipationCta} for one viewer on one event.
 *
 * The order of the branches IS the policy:
 *
 * 1. A state outside 005's registrable set (`ended` / `hidden`) offers
 *    nothing — `unavailable` with the reason said in words (EARS-10: no dead
 *    CTA on a finished event).
 * 2. A registered viewer on a `live` event enters the room (EARS-7). Room
 *    entry is reachable ONLY by a registration holder; every other reader
 *    falls through to the participation path below.
 * 3. A registered viewer on an upcoming event sees the registered state.
 * 4. Otherwise participation is being offered, and the seat facts decide the
 *    shape (LD-5): a hybrid event with its offline half full switches the
 *    doctor to online, a pure offline event with no seats says «мест нет» with
 *    no target at all and NO waiting list, and everything else registers.
 */
export function resolveParticipationCta(
  facts: ParticipationFacts,
  routes: ParticipationRoutes,
): ParticipationCta {
  const { slug, state, format, registered } = facts;

  if (!isRegistrable(state)) {
    return {
      action: "unavailable",
      label: LABELS.unavailable,
      href: null,
      reason:
        state === "hidden"
          ? "Мероприятие скрыто — участие в нём больше не предлагается"
          : "Событие завершилось",
    };
  }

  if (state === "live" && registered) {
    return {
      action: "enter-room",
      label: LABELS["enter-room"],
      href: routes.roomPath ? routes.roomPath(slug) : null,
      reason: null,
    };
  }

  if (registered) {
    return {
      action: "registered",
      label: LABELS.registered,
      href: null,
      reason: null,
    };
  }

  if (offlineSeatsExhausted(facts)) {
    if (format === "hybrid") {
      return {
        action: "switch-to-online",
        label: LABELS["switch-to-online"],
        href: registrationHref(routes, slug),
        reason: "Очные места закончились — участвовать можно онлайн",
      };
    }
    return {
      action: "sold-out",
      label: LABELS["sold-out"],
      href: null,
      // No waiting list exists in the model, so none may be offered here
      // (EARS-9): the honest statement is the whole affordance.
      reason: "Очные места закончились, лист ожидания не ведётся",
    };
  }

  return {
    action: "register",
    label: LABELS.register,
    href: registrationHref(routes, slug),
    reason: null,
  };
}
