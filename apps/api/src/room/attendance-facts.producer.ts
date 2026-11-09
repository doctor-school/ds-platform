import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import { PointsEngine } from "../points/engine/points-engine.service.js";
import { PresenceRepository } from "./presence.repository.js";
import { ROOM_HEARTBEAT_INTERVAL_SECONDS } from "./room.tokens.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The ended event, as the transition that ends it hands it over. */
export interface EndedEvent {
  id: string;
  /** The scheduled duration — the basis of the presence share (025 EARS-9). */
  durationMin: number;
  /** The instant the end committed — every fact's `occurredAt`. */
  endedAt: Date;
}

/**
 * The fact event id of a doctor's attendance on an event: one per
 * (fact type, person, ref), so a replay of the end answers `duplicate`
 * (025 EARS-33, amended EARS-4).
 */
export function attendanceFactEventId(eventId: string, userId: string): string {
  return `attendance.confirmed:${userId}:${eventId}`;
}

/**
 * The presence share of `minutes` over a `durationMin` event: whole percent,
 * rounded down, clamped to 0…100 (025 EARS-9). A non-positive duration has no
 * share to give and answers 0.
 */
export function presenceSharePercent(
  minutes: number,
  durationMin: number,
): number {
  if (!(durationMin > 0)) return 0;
  const share = Math.floor((100 * minutes) / durationMin);
  return Math.min(100, Math.max(0, share));
}

/**
 * 025 EARS-9 — the room reports attendance when the event ends. For every
 * doctor with presence on the event it records one `attendance.confirmed`
 * through {@link PointsEngine.record}, inside the transaction that commits the
 * end: `ref` = the event, `presenceSharePercent` = the server-side share of
 * the scheduled duration, `registrationId` = the doctor's registration or
 * null, `occurredAt` = the end. It reports facts only — no amount, rule or
 * denomination (EARS-33); a share below `setting.presence.share` is recorded
 * too, and the seeded rule's condition decides it does not count.
 *
 * Returns the publish of every recorded fact; the caller runs it after its
 * COMMIT and never after a rollback.
 */
@Injectable()
export class AttendanceFactsProducer {
  constructor(
    @Inject(PresenceRepository)
    private readonly presence: PresenceRepository,
    @Inject(PointsEngine) private readonly points: PointsEngine,
    @Inject(ROOM_HEARTBEAT_INTERVAL_SECONDS)
    private readonly heartbeatIntervalSeconds: number,
  ) {}

  async recordEventEnd(
    tx: Tx,
    event: EndedEvent,
  ): Promise<() => Promise<void>> {
    const attendance = await this.presence.attendanceAtEnd(
      tx,
      event.id,
      this.heartbeatIntervalSeconds,
    );
    const publishes: Array<() => Promise<void>> = [];
    for (const doctor of attendance) {
      const result = await this.points.record(tx, {
        type: "attendance.confirmed",
        eventId: attendanceFactEventId(event.id, doctor.userId),
        personId: doctor.userId,
        ref: event.id,
        occurredAt: event.endedAt,
        attributes: {
          presenceSharePercent: presenceSharePercent(
            doctor.minutes,
            event.durationMin,
          ),
          registrationId: doctor.registrationId,
        },
      });
      publishes.push(result.publishAfterCommit);
    }
    return async () => {
      for (const publish of publishes) await publish();
    };
  }
}
