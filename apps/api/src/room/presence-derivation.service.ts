import { Inject, Injectable } from "@nestjs/common";
import type { EventPresence } from "@ds/schemas";
import { PresenceRepository } from "./presence.repository.js";
import { ROOM_HEARTBEAT_INTERVAL_SECONDS } from "./room.tokens.js";

/**
 * 006 EARS-5 — the per-doctor presence-minute derivation (design §5). It reads
 * the durable append-only `presence_beats` (captured by EARS-4) and yields the
 * `EventPresence` read model: per-doctor `{ userId, eventId, minutes }`, the unit
 * the wave-1 sponsor report draws from by **manual export**. There is **no**
 * report UI and **no** public endpoint in wave 1 — this is a standalone ops read
 * surfaced by the `presence:export` CLI ({@link file://../../scripts/presence-export.ts});
 * the derivation is never exposed on a public surface (EARS-8).
 *
 * **Parameterized over N.** The minutes are computed at the server heartbeat
 * cadence N — bound from `ROOM_HEARTBEAT_INTERVAL_SECONDS` (the SAME config the
 * grant carries to the client, EARS-4) and passed to
 * {@link PresenceRepository.deriveEventMinutes}. An operator-confirmed different
 * cadence changes CONFIG (the env value, or an explicit `intervalSeconds`
 * override for a what-if export), not the spec or the code (owner decision
 * 2026-07-06). Concurrent-tab coalescing is enforced in the repository's
 * DISTINCT-bucket query, so this service is a thin config-binding + shaping layer.
 */
@Injectable()
export class PresenceDerivationService {
  constructor(
    @Inject(PresenceRepository)
    private readonly presence: PresenceRepository,
    @Inject(ROOM_HEARTBEAT_INTERVAL_SECONDS)
    private readonly heartbeatIntervalSeconds: number,
  ) {}

  /**
   * Derive the {@link EventPresence} for one event. `intervalSeconds` defaults to
   * the server-config cadence N (`ROOM_HEARTBEAT_INTERVAL_SECONDS`) — the
   * production/export path; an explicit value recomputes the same beats at a
   * different cadence with no code change (a what-if / re-cadenced export). The
   * returned `intervalSeconds` records which N the minutes were computed at, so a
   * consumer never confuses a 60 s export with a 30 s one.
   */
  async deriveForEvent(
    eventId: string,
    intervalSeconds: number = this.heartbeatIntervalSeconds,
  ): Promise<EventPresence> {
    const doctors = await this.presence.deriveEventMinutes(
      eventId,
      intervalSeconds,
    );
    return { eventId, intervalSeconds, doctors };
  }
}
