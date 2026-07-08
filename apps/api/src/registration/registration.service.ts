import { Injectable } from "@nestjs/common";
import {
  type EventLifecycleState,
  type EventRegistrationState,
  type EventRoster,
  isRegistrable,
  type MyEvents,
} from "@ds/schemas";
import { AIR_WINDOW_MS } from "../events/events.service.js";
import { RegistrationRepository } from "./registration.repository.js";

/**
 * The register affordance is offered only while the event is `published`
 * (upcoming) or `live` (design §5). `RegisterForEvent` on an `ended`/`archived`
 * (or `draft`) event is refused with this error — HTTP-agnostic so the guard
 * stays a pure domain rule; the controller maps it to a 409 state conflict. No
 * registration is recorded. `state` is the offending current state. The
 * exhaustive gating semantics (affordance-absent, ended/archived verification)
 * are the sibling EARS-9 handler; EARS-1 accepts published/live only.
 */
export class EventNotRegistrableError extends Error {
  constructor(readonly state: EventLifecycleState) {
    super(`registration is not offered while the event is ${state}`);
    this.name = "EventNotRegistrableError";
  }
}

/**
 * The authenticated subject has a live session but no 003 mirror row — it cannot
 * be attributed a registration. HTTP-agnostic; the controller maps it to a 401.
 * In practice the mirror is created by the 003 registration cascade, so a
 * logged-in `doctor_guest` always resolves; this is the fail-closed guard for the
 * impossible-but-not-silently-satisfied case (EARS-10).
 */
export class UnknownSubjectError extends Error {
  constructor(readonly sub: string) {
    super("authenticated subject has no user record");
    this.name = "UnknownSubjectError";
  }
}

/** Distinguishes "event does not exist" from a state refusal — mapped to a 404. */
export class RegistrationEventNotFoundError extends Error {
  constructor(readonly idOrSlug: string) {
    super(`event not found: ${idOrSlug}`);
    this.name = "RegistrationEventNotFoundError";
  }
}

/**
 * 005 registration write + per-user read (design §1, §3, §5). The single
 * `doctor_guest`-authenticated `RegisterForEvent` command and the immediate
 * `EventRegistrationState` read that flips to `registered` after it. Both paths
 * resolve the acting doctor's `user_id` from the authenticated Zitadel `sub`
 * (003 mirror) and the target event from its slug/id (007 read model, read-only).
 */
@Injectable()
export class RegistrationService {
  constructor(private readonly repo: RegistrationRepository) {}

  /**
   * `RegisterForEvent` (EARS-1 + EARS-3): record a registration against the
   * authenticated doctor's account in **one action** and return the registered
   * state so the event page flips immediately, no confirmation round-trip.
   * Idempotent (EARS-3) — a repeat via any path is a no-op that returns the
   * existing registration ({@link RegistrationRepository.upsertRegistration}):
   * the DB `UNIQUE (user_id, event_id)` constraint guarantees at most one row,
   * and the terminal `audit_ledger` entry is written once, on the first insert
   * only. Both the first insert and an idempotent repeat return
   * `{ registered: true, registeredAt }` (design §5). Gating: the event must be
   * `published`/`live` (else {@link EventNotRegistrableError}); the event must
   * exist (else {@link RegistrationEventNotFoundError}); the subject must resolve
   * to a mirror row (else {@link UnknownSubjectError}).
   */
  async register(
    idOrSlug: string,
    sub: string,
  ): Promise<EventRegistrationState> {
    const userId = await this.resolveUser(sub);
    const event = await this.resolveEvent(idOrSlug);
    if (!isRegistrable(event.state)) {
      throw new EventNotRegistrableError(event.state);
    }
    const { registeredAt } = await this.repo.upsertRegistration(
      userId,
      event.id,
      sub,
    );
    return { registered: true, registeredAt: registeredAt.toISOString() };
  }

  /**
   * The per-caller `EventRegistrationState` read (design §4/§5) — `{ registered:
   * true, registeredAt }` when the caller holds a registration for the event,
   * `{ registered: false }` otherwise. Reads only the caller's own state (EARS-10).
   * A missing event is a 404 (never a silent `registered:false`).
   */
  async state(idOrSlug: string, sub: string): Promise<EventRegistrationState> {
    const userId = await this.resolveUser(sub);
    const event = await this.resolveEvent(idOrSlug);
    const registeredAt = await this.repo.findRegisteredAt(userId, event.id);
    return registeredAt
      ? { registered: true, registeredAt: registeredAt.toISOString() }
      : { registered: false };
  }

  /**
   * `MyEvents` (EARS-6; design §4/§5): the authenticated doctor's registered
   * **upcoming** events (`published`/`live`, future or currently airing), ordered
   * NEAREST `startsAt` first. Returns only the caller's own registrations
   * (EARS-10); an empty result is a valid `[]` (the «мои события» surface renders
   * the empty-state). The temporal window mirrors the 004 upcoming listing — an
   * event the doctor registered for appears here iff it would still appear as
   * upcoming/live publicly (`starts_at ≥ now − {@link AIR_WINDOW_MS}`), with the
   * lifecycle STATE (not the clock) the primary filter (`ended`/`archived` never
   * list). A just-registered event appears on the next read (EARS-7).
   */
  async myEvents(sub: string, now: Date = new Date()): Promise<MyEvents> {
    const userId = await this.resolveUser(sub);
    const cutoff = new Date(now.getTime() - AIR_WINDOW_MS);
    return this.repo.findMyEvents(userId, cutoff);
  }

  /**
   * `EventRoster` (EARS-8; design §2/§4): the set of **current** registrations
   * for one event — the durable basis 005 owns and feature 006 (room admission)
   * + the wave-2 sponsor report **consume** to admit/attribute exactly the
   * recorded registrations. Resolves the event by slug/id (a missing event is a
   * {@link RegistrationEventNotFoundError}, never a silent empty list), then reads
   * every registration row for it — wave 1 has no cancelled state, so the roster
   * is every row and every entry is current (Invariants). Each entry carries no
   * more than the `(doctor, event, registeredAt)` fact; no registrant PII, and no
   * public exposure — this is an INTERNAL read with no HTTP route (design §4;
   * EARS-8, EARS-10). It is the read 006 will call in-process; 005 owns and tests
   * it here.
   */
  async eventRoster(idOrSlug: string): Promise<EventRoster> {
    const event = await this.resolveEvent(idOrSlug);
    return this.repo.findEventRoster(event.id);
  }

  private async resolveUser(sub: string): Promise<string> {
    const userId = await this.repo.findUserIdBySub(sub);
    if (!userId) throw new UnknownSubjectError(sub);
    return userId;
  }

  private async resolveEvent(
    idOrSlug: string,
  ): Promise<{ id: string; state: EventLifecycleState }> {
    const event = await this.repo.findEventForRegistration(idOrSlug);
    if (!event) throw new RegistrationEventNotFoundError(idOrSlug);
    return event;
  }
}
