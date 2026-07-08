import { Inject, Injectable } from "@nestjs/common";
import type {
  EventLifecycleState,
  PresenceHeartbeatAck,
  RoomConfig,
} from "@ds/schemas";
import {
  RegistrationService,
  UnknownSubjectError,
} from "../registration/registration.service.js";
import { PresenceRepository } from "./presence.repository.js";
import { resolveRoomStream } from "./provider-enum.js";
import { RoomRepository, type EventForRoom } from "./room.repository.js";
import { ROOM_HEARTBEAT_INTERVAL_SECONDS } from "./room.tokens.js";

/**
 * The event whose room was requested does not exist. HTTP-agnostic so the gate
 * stays a pure domain rule; the controller maps it to a 404 (indistinguishable
 * from an unknown slug — a hidden event leaks no oracle). `idOrSlug` is the
 * offending reference.
 */
export class RoomEventNotFoundError extends Error {
  constructor(readonly idOrSlug: string) {
    super(`event not found: ${idOrSlug}`);
    this.name = "RoomEventNotFoundError";
  }
}

/**
 * The authenticated caller is not registered for the event (their `(doctor,
 * event)` pair is absent from the 005 `EventRoster`). HTTP-agnostic — the
 * controller maps it to a 403 so the portal routes the caller to register (005,
 * EARS-6). No room content is served; the refusal is server-side (EARS-1).
 */
export class NotRegisteredError extends Error {
  constructor() {
    super("caller is not registered for this event");
    this.name = "NotRegisteredError";
  }
}

/**
 * The event exists and the caller is registered, but the event is not `live` —
 * the room is not open (not yet opened, or already closed). HTTP-agnostic — the
 * controller maps it to a 409 so the portal shows the truthful 004 lifecycle
 * state (EARS-6). `state` is the offending current state; no grant is issued.
 */
export class RoomNotLiveError extends Error {
  constructor(readonly state: EventLifecycleState) {
    super(`room is not open while the event is ${state}`);
    this.name = "RoomNotLiveError";
  }
}

/**
 * 006 EARS-1 — the server-side room admission gate (design §2). The single
 * policy `authenticated ∧ registered ∧ live` that guards all room content: a
 * caller receives the `RoomConfig` grant ONLY when all three hold, and a request
 * that fails any condition is refused SERVER-SIDE (401 / 403 / 409) — there is
 * no soft UI wall that renders the room for an ungated caller (EARS-1, EARS-8).
 *
 * The gate REUSES, never reimplements, its inputs (F-22 / requirements
 * Constraints): the `registered` condition reads the 005 `EventRoster` through
 * {@link RegistrationService} (006 adds no registration primitive and creates no
 * registration), and the `live` condition reads the 004/007-owned
 * `EventLifecycleState` through {@link RoomRepository} (a thin read-only view of
 * the `events` aggregate; 006 reads the state 007 writes, never mutates it). The
 * `authenticated` condition is the 003 BFF
 * session — the global `AuthzGuard` refuses an unauthenticated caller before the
 * handler runs; this service is the resource-scoped policy the `policy`
 * classification denotes (registration+live is a decision the role alone cannot
 * make — design §2).
 *
 * The same gate is the reusable admission decision the sibling gated commands
 * (`PostChatMessage` EARS-3, `RecordPresenceHeartbeat` EARS-4) evaluate before
 * any Centrifugo publish or Postgres append; EARS-1 ships the gate + the
 * `RoomConfig` read that issues the grant.
 */
@Injectable()
export class RoomService {
  // Explicit `@Inject(Class)` tokens (not bare paramtype reflection): the class
  // deps appear only in type positions here, which the esbuild-based test/tsx
  // transform elides — leaving `design:paramtypes` undefined and breaking DI in
  // the endpoint-authz gate boot. Naming the token as a value keeps the import
  // and the provider resolvable under every transform.
  constructor(
    @Inject(RoomRepository) private readonly rooms: RoomRepository,
    @Inject(RegistrationService)
    private readonly registration: RegistrationService,
    @Inject(PresenceRepository) private readonly presence: PresenceRepository,
    @Inject(ROOM_HEARTBEAT_INTERVAL_SECONDS)
    private readonly heartbeatIntervalSeconds: number,
  ) {}

  /**
   * The single server-side admission gate (`authenticated ∧ registered ∧ live`)
   * every room operation evaluates before serving content or accepting a write
   * (design §2). Reused verbatim by the `RoomConfig` read (EARS-1) and the gated
   * `RecordPresenceHeartbeat` command (EARS-4) — there is ONE gate, not a
   * per-operation copy, so a beat can never be accepted on a laxer rule than the
   * config read. Conditions are evaluated in the design §2 order so a refusal
   * maps to the correct EARS-6 branch: the event must exist
   * ({@link RoomEventNotFoundError} → 404), the caller must be registered
   * ({@link NotRegisteredError} → 403, before the live check), and the event must
   * be `live` ({@link RoomNotLiveError} → 409). An authenticated subject with no
   * 003 mirror row cannot own a registration and is refused with the registration
   * layer's `UnknownSubjectError` (→ 401), never silently admitted. Returns the
   * resolved event on success.
   */
  private async admit(idOrSlug: string, sub: string): Promise<EventForRoom> {
    // Resolve the event first: a missing event is a 404, and the `live` check
    // needs its canonical state + id (the grant's / beat's room identity).
    const event = await this.rooms.findEventForRoom(idOrSlug);
    if (!event) throw new RoomEventNotFoundError(idOrSlug);

    // Registered condition — read the 005 roster via the caller's own
    // `EventRegistrationState` (reused, not reimplemented). `state()` resolves
    // the acting doctor from the authenticated `sub`; an unknown subject throws
    // `UnknownSubjectError` (→ 401). Checked BEFORE the live condition so an
    // unregistered caller is routed to register (403), per design §2.
    const { registered } = await this.registration.state(idOrSlug, sub);
    if (!registered) throw new NotRegisteredError();

    // Live condition — the room is open only while the event is `live`.
    if (event.state !== "live") throw new RoomNotLiveError(event.state);

    return event;
  }

  /**
   * Evaluate the admission gate for `(idOrSlug, sub)` and, on success, issue the
   * server-side `RoomAccess` grant as a {@link RoomConfig} (EARS-1). The grant
   * carries the server-config heartbeat cadence N the client drives its presence
   * loop from (EARS-4) and the EARS-2 embed source resolved from the 007-authored
   * stream config: the provider is read from the closed enum (never URL-sniffed),
   * and an absent/unknown provider yields `stream: null` — the truthful "stream
   * unavailable" room state, still a valid grant (the gate admitted the caller).
   */
  async roomConfig(idOrSlug: string, sub: string): Promise<RoomConfig> {
    const event = await this.admit(idOrSlug, sub);
    return {
      eventId: event.id,
      heartbeatIntervalSeconds: this.heartbeatIntervalSeconds,
      stream: resolveRoomStream(event.streamConfig),
    };
  }

  /**
   * `RecordPresenceHeartbeat` (EARS-4; design §5) — behind the SAME gate as the
   * config read: a guest / unregistered / non-`live` caller is refused
   * server-side ({@link admit}) and NO beat is appended (EARS-8). On admission it
   * appends exactly one immutable `(doctor, event, instant)` row to the durable
   * append-only presence table and returns the server-authoritative ack. The beat
   * is attributed to the acting doctor resolved from the authenticated `sub`; the
   * `registered` check inside `admit` already proved a 003 mirror row exists, so
   * the resolve succeeds — the `null` guard is fail-closed defence in depth (→
   * 401), never a silent admission. Concurrent tabs each append a raw beat; the
   * coalescing into one presence timeline is the EARS-5 read-time derivation, not
   * a write-time suppression here — presence is server-authoritative and durable,
   * never a client-trusted count.
   */
  async recordHeartbeat(
    idOrSlug: string,
    sub: string,
  ): Promise<PresenceHeartbeatAck> {
    const event = await this.admit(idOrSlug, sub);
    const userId = await this.presence.findUserIdBySub(sub);
    if (!userId) throw new UnknownSubjectError(sub);
    const { beatAt } = await this.presence.appendBeat(userId, event.id);
    return { eventId: event.id, beatAt: beatAt.toISOString() };
  }
}
