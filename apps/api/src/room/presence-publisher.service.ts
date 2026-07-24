import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { CentrifugoChatGateway } from "./chat.gateway.js";
import { PresenceRepository } from "./presence.repository.js";
import { ROOM_HEARTBEAT_INTERVAL_SECONDS } from "./room.tokens.js";

/** Never schedule a fire in the past / immediately — a small floor so a just-
 * expired window still yields one clean macrotask hop, never a hot re-arm loop. */
const MIN_FIRE_DELAY_MS = 50;

interface RoomTimer {
  timer: ReturnType<typeof setTimeout> | null;
  /** The last count actually fanned out — the change-detection latch. `null` = the
   * room has never published, so the first computed count always fans out. */
  lastPublished: number | null;
}

/**
 * 006 EARS-5 — the realtime presence-count publisher (design §5 "Realtime
 * presence-count push"). It turns the server-authoritative distinct-doctor count
 * into an instant fan-out over the room's Centrifugo channel on the two paths that
 * CHANGE it:
 *
 * 1. **Accepted beat.** {@link RoomService.recordHeartbeat} already computed the
 *    post-append count for its ack; it hands that value here so a *join* (or the
 *    caller's own first beat) fans out to every other subscriber immediately —
 *    without them waiting on their own next beat (the #1122 "frozen until my beat"
 *    perception, now the fast path).
 * 2. **Window expiry.** A *leave* is a beat that simply stopped — no request fires
 *    when a doctor closes the tab. So on each beat the publisher (re-)arms ONE
 *    per-room timer at the next {@link PresenceRepository.nextPresenceExpiry}
 *    instant; when it fires it recomputes the count and, if it dropped, publishes —
 *    so a leave is fanned out within ~1 s of the count changing server-side, not on
 *    the next surviving observer's beat.
 *
 * **Publish only on change.** A per-room `lastPublished` latch suppresses a
 * fan-out when the recomputed count equals the last one published, so a steady room
 * (every doctor beating, nobody joining/leaving) emits nothing.
 *
 * **Best-effort, never in the beat's critical path.** `recordHeartbeat` fire-and-
 * forgets `onBeat` (it does not await it), and every publish/query failure is
 * swallowed here — a Centrifugo blip leaves the heartbeat-ack refresh (#1136) as the
 * truthful fallback (the portal degrades to beat-paced counts, never a frozen
 * value), and never turns a beat into a 5xx. When Centrifugo is unconfigured the
 * gateway is disabled and the publisher is inert (the portal never subscribes, so
 * the ack path is the only path anyway).
 *
 * **Scope (Phase 0).** In-memory per-instance state: the change latch and timers
 * live in this process. A second api instance would recompute and publish the SAME
 * count — an idempotent duplicate a subscriber applies once (last-writer-wins on an
 * integer), never a wrong value; the durable source of truth stays the append-only
 * beats. A cross-instance shared latch is deferred (not needed for the single
 * Phase-0 api instance).
 */
@Injectable()
export class PresencePublisher implements OnModuleDestroy {
  private readonly rooms = new Map<string, RoomTimer>();

  constructor(
    @Inject(CentrifugoChatGateway)
    private readonly gateway: CentrifugoChatGateway,
    @Inject(PresenceRepository) private readonly presence: PresenceRepository,
    @Inject(ROOM_HEARTBEAT_INTERVAL_SECONDS)
    private readonly heartbeatIntervalSeconds: number,
  ) {}

  /** The freshness window the count is derived over — two heartbeat cadences, the
   * SAME `2 × N` {@link RoomService} reads (an operator-confirmed different cadence
   * widens both with no code change). */
  private windowSeconds(): number {
    return this.heartbeatIntervalSeconds * 2;
  }

  /**
   * The beat path: publish the just-computed `count` if it changed, then (re-)arm
   * the room's expiry timer so an ensuing leave is caught. Fire-and-forget from
   * {@link RoomService.recordHeartbeat} — it NEVER throws (a failure is swallowed so
   * the beat is unaffected) and returns a promise only so tests can await it.
   */
  async onBeat(eventId: string, count: number): Promise<void> {
    // Centrifugo unconfigured → nothing subscribes; stay inert (ack-path only).
    if (!this.gateway.enabled) return;
    try {
      await this.publishIfChanged(eventId, count);
      await this.arm(eventId);
    } catch {
      // Best-effort: a publish/query failure never reaches the beat (#1136 fallback).
    }
  }

  /** Publish `count` over the room channel unless it equals the last fanned-out
   * value. `lastPublished` advances ONLY on a successful publish, so a transient
   * Centrifugo failure is retried on the next change rather than latched as done. */
  private async publishIfChanged(eventId: string, count: number): Promise<void> {
    const room = this.roomState(eventId);
    if (room.lastPublished === count) return;
    await this.gateway.publishPresenceCount(eventId, count);
    room.lastPublished = count;
  }

  /** (Re-)arm the single per-room timer at the next window-expiry instant. A fresh
   * beat that postpones the soonest age-out re-arms it later; no in-window doctor
   * means nothing to age out, so no timer is set. */
  private async arm(eventId: string): Promise<void> {
    const room = this.roomState(eventId);
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    const expiresAt = await this.presence.nextPresenceExpiry(
      eventId,
      this.windowSeconds(),
    );
    if (!expiresAt) return;
    const delay = Math.max(expiresAt.getTime() - Date.now(), MIN_FIRE_DELAY_MS);
    room.timer = setTimeout(() => {
      void this.fire(eventId);
    }, delay);
    // Node-only: do not keep the process alive for a pending presence timer.
    room.timer.unref?.();
  }

  /** The expiry path: recompute the live count, publish if it dropped/changed, and
   * re-arm for the next age-out (a room can shed doctors one expiry at a time). */
  private async fire(eventId: string): Promise<void> {
    const room = this.roomState(eventId);
    room.timer = null;
    try {
      const count = await this.presence.countLivePresence(
        eventId,
        this.windowSeconds(),
      );
      await this.publishIfChanged(eventId, count);
      await this.arm(eventId);
    } catch {
      // Best-effort: a failed expiry recompute leaves the ack path as the fallback.
    }
  }

  private roomState(eventId: string): RoomTimer {
    let room = this.rooms.get(eventId);
    if (!room) {
      room = { timer: null, lastPublished: null };
      this.rooms.set(eventId, room);
    }
    return room;
  }

  /** Clear every pending timer on shutdown so no room timer outlives the module. */
  onModuleDestroy(): void {
    for (const room of this.rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
    }
    this.rooms.clear();
  }
}
